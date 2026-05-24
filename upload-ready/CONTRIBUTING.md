# Contributing to Jericho

Thank you for your interest in Jericho! This document covers the basics.

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `style:` — Formatting, missing semicolons, etc.
- `refactor:` — Code change that neither fixes a bug nor adds a feature
- `perf:` — Performance improvement
- `test:` — Adding or correcting tests
- `chore:` — Build process, dependencies, etc.

Examples:
```
feat: add offline command queue for native apps
fix: prevent path traversal in file upload endpoint
docs: update deployment guide for Raspberry Pi
```

## Branch Strategy

- `main` — Production-ready code
- `feat/*` — Feature branches
- `fix/*` — Bug fix branches
- `docs/*` — Documentation updates

## Code Style

### Python (Backend)
- PEP 8 compliant
- Black formatter recommended
- Type hints encouraged for new functions

### Go (Bridge)
- `gofmt` required
- Error handling: check and log, never swallow

### JavaScript (Frontend)
- Vanilla JS — no build step required
- ES6+ features acceptable
- Keep browser compatibility in mind (Chrome 90+, Safari 15+, Firefox 90+)

## Security

- Never commit secrets (`.env`, tokens, passwords)
- Use `YOUR_*` placeholders in examples
- Report security issues privately before public disclosure

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -am 'feat: add some feature'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request against `main`

## Questions?

Open a [Discussion](https://github.com/YOUR_USERNAME/jericho/discussions) or reach out in the community chat.
