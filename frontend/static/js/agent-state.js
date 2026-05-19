// agent-state.js — ANSI-based AI agent state detector
// Parses terminal output to infer agent activity state

class AgentStateDetector {
  constructor() {
    this.currentState = 'idle';
    this.patterns = [
      { regex: /[◐◑◒◓✻✽⏳⏲⏱⏰]/, state: 'thinking', confidence: 0.85 },
      { regex: /\u001B\[33m.*(?:Needs input|⚠|waiting|prompt)/i, state: 'waiting', confidence: 0.8 },
      { regex: /\r?\n\u001B\[0?m?[\$#>➜~]\s/, state: 'idle', confidence: 0.7 },
      { regex: /(?:Reading|Writing|Editing|Searching)\s+\S+\.(?:ts|js|py|go|rs|java|cpp|c|h|md|txt|json|yaml|yml)/i, state: 'executing', confidence: 0.8 },
      { regex: /\u001B\[31m(?:Error|Failed|Exception|panic)/i, state: 'error', confidence: 0.9 },
      { regex: /\u001B\[32m(?:✔|✓|\[Completed\]|Done)/i, state: 'idle', confidence: 0.75 },
      { regex: /(?:thinking|generating|analyzing|processing)\s*\.\.\./i, state: 'thinking', confidence: 0.8 },
      { regex: /\[subagent\]|\d+\s+tasks?|parallel\s+agent/i, state: 'executing', confidence: 0.85 },
      { regex: /(?:Added|Loading)\s+.*\s+to\s+(?:the\s+)?chat/i, state: 'listening', confidence: 0.75 },
      { regex: /(?: kimi\s*[|>]|\$\s*kimi|>\s*kimi)/i, state: 'listening', confidence: 0.6 },
    ];
    this.lastActivity = Date.now();
    this.idleTimeout = 5000; // ms before falling back to idle
  }

  ingest(data) {
    this.lastActivity = Date.now();
    const text = this.stripAnsi(data);

    for (const { regex, state, confidence } of this.patterns) {
      if (regex.test(data) || regex.test(text)) {
        this.transitionTo(state, confidence);
        return this.currentState;
      }
    }

    // If no pattern matched and we've been idle for a while, return to idle
    if (Date.now() - this.lastActivity > this.idleTimeout && this.currentState !== 'idle') {
      this.transitionTo('idle', 0.5);
    }

    return this.currentState;
  }

  stripAnsi(str) {
    return str.replace(/\u001B\[[0-9;]*[a-zA-Z]/g, '').replace(/\u001B\][0-9;]*\u0007/g, '');
  }

  transitionTo(newState, confidence) {
    if (newState !== this.currentState) {
      this.currentState = newState;
    }
  }

  getState() {
    return this.currentState;
  }
}
