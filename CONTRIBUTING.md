# Contributing to StellarPay

Thank you for your interest in building decentralized payroll infrastructure on Stellar! This guide will help you contribute effectively.

## 🛠 Tech Stack

- **Smart Contracts:** Soroban (Rust)
- **Frontend:** Next.js, TypeScript, Tailwind CSS, Freighter Wallet
- **Backend:** FastAPI/Express, PostgreSQL, Redis
- **SDK:** TypeScript

## ⚠️ Module Deprecation Notice

The `treasury` and `governance` modules in this repository are **deprecated** and migrating to [StellarSentinel](https://github.com/Stellar-Re-Code/StellarSentinel). See [docs/MODULE_BOUNDARY.md](docs/MODULE_BOUNDARY.md) for the disposition matrix.

**Do not start new work on deprecated modules.** Existing issues for treasury (SC-1..SC-8, FE-6..FE-10) and governance (SC-21..SC-25, FE-20..FE-23) will be transferred to StellarSentinel.

## 📝 Commit Guidelines (Strict)

We follow a strict **Modular Commit** philosophy to ensure history is readable and revertible.

**The Golden Rule:**
> "Commit after every meaningful change, not every line."

- **Meaningful Change:** Completing a function, finishing a fix, adding a feature block, creating a file, or making a significant modification.
- **Avoid:** Micro-commits for single-line edits unless they are standalone fixes.
- **Frequency:** Commit often, but only when you finish a logical piece of work.

### Commit Message Format

```
<type>(<scope>): <description>
```

**Types:**
- `feat` — A new feature
- `fix` — A bug fix
- `docs` — Documentation changes
- `test` — Adding or updating tests
- `refactor` — Code change that neither fixes a bug nor adds a feature
- `style` — Formatting, missing semicolons, etc.
- `chore` — Updating build tasks, package manager configs, etc.

**Scopes:** `payroll`, `vesting`, `frontend`, `backend`, `sdk`, `ci`
_`treasury` and `governance` scopes are deprecated — use StellarSentinel for these._

### Example Commit Messages
- `feat(payroll): implement claimable amount calculation`
- `fix(vesting): correct cliff boundary logic`
- `test(vesting): add cliff boundary tests`
- `docs(frontend): update integration guide with examples`
- `feat(sdk): add payroll stream client wrapper`

## 📋 Issue Tracking

1. Pick an issue from one of the issue trackers in `docs/`:
   - `ISSUES-SMARTCONTRACT.md` (SC-9 to SC-20)
   - `ISSUES-FRONTEND.md` (FE-1 to FE-5, FE-11 to FE-19, FE-24 to FE-25)
   - `ISSUES-BACKEND.md` (BK-1 to BK-10)
   - `ISSUES-SDK-TOOLING.md` (TL-1 to TL-10, excluding TL-2, TL-7)

   **Deprecated issue ranges (migrating to StellarSentinel):**
   - Treasury: SC-1..SC-8, FE-6..FE-10, TL-2
   - Governance: SC-21..SC-25, FE-20..FE-23, TL-7

2. When you start, comment on the GitHub issue or mark it as "In Progress".

3. **When Completed:** You MUST update the issue tracker doc with:
   - Check the box `[x]`
   - Append your GitHub username and Date/Time.
   - *Example:* `- [x] Implement claim logic (@yourname - 2026-02-18 14:00 UTC)`

## 🧪 Development Workflow

1. **Fork & Clone**: Fork this repo and clone it locally.
2. **Branch**: Create a feature branch from `main`:
   ```bash
   git checkout -b feat/SC-9-streaming-logic
   ```
3. **Develop**: Write code following the Style Guide (`STYLE.md`).
4. **Test**: Run tests for your area:
   ```bash
   # Smart Contracts
   cd contracts && cargo test --all

   # Frontend
   cd frontend && npm run lint
   ```
5. **Commit**: Follow the commit guidelines above.
6. **Pull Request**: Submit a PR with:
   - Reference the issue number (e.g., "Closes SC-9")
   - Description of changes
   - Testing notes

## 🗂 PR Review Checklist

Before submitting, ensure:
- [ ] Code compiles without warnings
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] Documentation updated if needed
- [ ] Issue tracker doc updated
- [ ] Commit messages follow conventions

## Getting Help

- Read the guides in `docs/` for detailed setup instructions
- Open an issue with the `question` label for help
- Be respectful and constructive in all interactions
