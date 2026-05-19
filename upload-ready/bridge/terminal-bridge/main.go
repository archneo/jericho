// jericho-terminal-bridge — Go WebSocket PTY server with ticket-based auth.
// Runs ON THE HOST (not in Docker) so it can spawn bash/kimi-cli directly.
package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

// ─── Config ───────────────────────────────────────────────────────────────────
const (
	listenAddr        = "127.0.0.1:9999"
	ringBufferSize    = 256 * 1024 // 256 KB
	heartbeatInterval = 30 * time.Second
)

var ticketSecret = os.Getenv("JERICHO_SECRET_KEY")

func init() {
	if ticketSecret == "" {
		ticketSecret = "dev-secret-change-me"
	}
}

// ─── JWT Claims ───────────────────────────────────────────────────────────────
type TicketClaims struct {
	Sub        string `json:"sub"`
	ClientType string `json:"client_type"`
	Tier       string `json:"tier"`
	Attested   bool   `json:"attested"`
	JTI        string `json:"jti"`
	jwt.RegisteredClaims
}

// ─── Session ──────────────────────────────────────────────────────────────────
type Session struct {
	ID         string
	PTY        *os.File
	WS         *websocket.Conn
	Buffer     *RingBuffer
	LastAt     time.Time
	ClientType string
	Tier       string
	Attested   bool
	Cmd        *exec.Cmd
	mu         sync.Mutex
}

type RingBuffer struct {
	data []byte
	size int
	mu   sync.Mutex
}

func NewRingBuffer(size int) *RingBuffer {
	return &RingBuffer{data: make([]byte, 0, size), size: size}
}

func (rb *RingBuffer) Write(p []byte) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.data = append(rb.data, p...)
	if len(rb.data) > rb.size {
		rb.data = rb.data[len(rb.data)-rb.size:]
	}
}

func (rb *RingBuffer) Read() []byte {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	out := make([]byte, len(rb.data))
	copy(out, rb.data)
	return out
}

// ─── Global State ─────────────────────────────────────────────────────────────
var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			// Allow all local, Tailscale, and direct IP access
			return true
		},
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
	}
	sessions     = make(map[string]*Session)
	sessionsMu   sync.RWMutex
	consumedJTIs = make(map[string]time.Time)
	consumedMu   sync.Mutex
)

// ─── HTTP Handlers ────────────────────────────────────────────────────────────
func health(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func handleWebTerminal(w http.ResponseWriter, r *http.Request, expectedClientType string) {
	ticketStr := r.URL.Query().Get("ticket")
	if ticketStr == "" {
		http.Error(w, "ticket required", http.StatusForbidden)
		return
	}

	claims, err := verifyTicket(ticketStr)
	if err != nil {
		log.Printf("ticket verification failed: %v", err)
		http.Error(w, "invalid ticket", http.StatusForbidden)
		return
	}

	if claims.ClientType != expectedClientType {
		http.Error(w, "client type mismatch", http.StatusForbidden)
		return
	}

	if expectedClientType == "native" {
		attestation := r.Header.Get("X-Attestation-Token")
		if attestation != "" {
			claims.Attested = mockVerifyAttestation(attestation)
		}
	}

	// Enforce tier-based session limits
	maxSessions := 1 // free
	if claims.Tier == "pro" {
		maxSessions = 5
	} else if claims.Tier == "team" {
		maxSessions = 100
	}

	if countSessions() >= maxSessions {
		http.Error(w, "max concurrent sessions reached", http.StatusTooManyRequests)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	sessionID := claims.JTI
	shell := r.URL.Query().Get("shell")
	if shell == "" {
		shell = "bash"
	}

	var cmd *exec.Cmd
	switch shell {
	case "kimi":
		sessionUUID := r.URL.Query().Get("uuid")
		if sessionUUID != "" {
			cmd = exec.Command("/home/YOUR_USER/.local/bin/kimi", "--session", sessionUUID)
		} else {
			cmd = exec.Command("/home/YOUR_USER/.local/bin/kimi")
		}
	default:
		cmd = exec.Command("bash", "-l")
	}

	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		fmt.Sprintf("JERICHO_CLIENT_TYPE=%s", claims.ClientType),
		fmt.Sprintf("JERICHO_TIER=%s", claims.Tier),
	)

	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("pty start failed: %v", err)
		conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","code":"pty_start_failed","message":"`+err.Error()+`"}`))
		return
	}
	defer ptmx.Close()

	sess := &Session{
		ID:         sessionID,
		PTY:        ptmx,
		WS:         conn,
		Buffer:     NewRingBuffer(ringBufferSize),
		LastAt:     time.Now(),
		ClientType: claims.ClientType,
		Tier:       claims.Tier,
		Attested:   claims.Attested,
		Cmd:        cmd,
	}

	sessionsMu.Lock()
	sessions[sessionID] = sess
	sessionsMu.Unlock()

	defer func() {
		sessionsMu.Lock()
		delete(sessions, sessionID)
		sessionsMu.Unlock()
		saveScrollback(sessionID, sess.Buffer.Read())
		cmd.Process.Signal(syscall.SIGTERM)
		time.Sleep(500 * time.Millisecond)
		cmd.Process.Kill()
	}()

	// Send ready
	readyMsg := fmt.Sprintf(
		`{"type":"ready","session":"%s","version":"v1","client_type":"%s","tier":"%s"}`,
		sessionID, claims.ClientType, claims.Tier,
	)
	conn.WriteMessage(websocket.TextMessage, []byte(readyMsg))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go heartbeatWriter(ctx, conn)

	// PTY → WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("pty read error: %v", err)
				}
				cancel()
				return
			}
			if n > 0 {
				sess.mu.Lock()
				sess.LastAt = time.Now()
				sess.mu.Unlock()
				sess.Buffer.Write(buf[:n])
				if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	// WebSocket → PTY + control messages
	for {
		msgType, payload, err := conn.ReadMessage()
		if err != nil {
			log.Printf("websocket read error: %v", err)
			return
		}

		sess.mu.Lock()
		sess.LastAt = time.Now()
		sess.mu.Unlock()

		switch msgType {
		case websocket.BinaryMessage:
			ptmx.Write(payload)

		case websocket.TextMessage:
			var ctrl map[string]interface{}
			if err := json.Unmarshal(payload, &ctrl); err == nil {
				switch ctrl["type"] {
				case "resize":
					cols := int(ctrl["cols"].(float64))
					rows := int(ctrl["rows"].(float64))
					pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
				case "heartbeat":
					// ack handled by heartbeatWriter
				}
			}
		}
	}
}

func handleWeb(w http.ResponseWriter, r *http.Request) {
	handleWebTerminal(w, r, "web")
}

func handleNative(w http.ResponseWriter, r *http.Request) {
	handleWebTerminal(w, r, "native")
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
func verifyTicket(tokenStr string) (*TicketClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &TicketClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(ticketSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*TicketClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid claims")
	}

	// Check JTI not consumed (idempotent for 30s)
	consumedMu.Lock()
	if consumedAt, exists := consumedJTIs[claims.JTI]; exists {
		consumedMu.Unlock()
		if time.Since(consumedAt) > 30*time.Second {
			return nil, fmt.Errorf("ticket already consumed")
		}
		// within 30s window — allow idempotent replay
		return claims, nil
	}
	consumedJTIs[claims.JTI] = time.Now()
	consumedMu.Unlock()

	// Cleanup old JTIs periodically
	go cleanupConsumedJTIs()

	return claims, nil
}

func cleanupConsumedJTIs() {
	consumedMu.Lock()
	defer consumedMu.Unlock()
	cutoff := time.Now().Add(-5 * time.Minute)
	for jti, t := range consumedJTIs {
		if t.Before(cutoff) {
			delete(consumedJTIs, jti)
		}
	}
}

func countSessions() int {
	sessionsMu.RLock()
	defer sessionsMu.RUnlock()
	return len(sessions)
}

func mockVerifyAttestation(token string) bool {
	log.Printf("[MOCK] attestation verification called with token len=%d", len(token))
	return true // stub until native apps are distributed
}

func heartbeatWriter(ctx context.Context, conn *websocket.Conn) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	seq := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			seq++
			msg := fmt.Sprintf(`{"type":"heartbeat","seq":%d,"ts":%d}`, seq, time.Now().UnixMilli())
			if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
				return
			}
		}
	}
}

func saveScrollback(sessionID string, data []byte) {
	if len(data) == 0 {
		return
	}
	path := fmt.Sprintf("/srv/jericho/data/terminal-sessions/%s.gz", sessionID)
	os.MkdirAll("/srv/jericho/data/terminal-sessions", 0755)
	f, err := os.Create(path)
	if err != nil {
		return
	}
	defer f.Close()
	gw := gzip.NewWriter(f)
	gw.Write(data)
	gw.Close()
}

// ─── Main ─────────────────────────────────────────────────────────────────────
func main() {
	http.HandleFunc("/health", health)
	http.HandleFunc("/ws/terminal/web", handleWeb)
	http.HandleFunc("/ws/terminal/native", handleNative)

	log.Printf("Jericho Terminal Bridge listening on %s", listenAddr)
	log.Fatal(http.ListenAndServe(listenAddr, nil))
}
