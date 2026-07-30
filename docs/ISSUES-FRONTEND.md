# Frontend Issues — StellarPay 🎨

This document tracks all UI/UX and frontend integration tasks for the **StellarPay** dashboard.

### 🛑 STRICT RULE FOR CONTRIBUTORS
**When you complete an issue:**
1. Mark the checkbox `[x]`
2. Append your GitHub username and the Date/Time.
3. **Example:** `- [x] Setup Tailwind config (@yourname - 2026-02-18 15:00 UTC)`

---

## 🚀 Module 1: Foundation & Config (FE-1 to FE-5)

### Issue #FE-1: Project Scaffold & Theme
**Priority:** Critical
**Labels:** `frontend`, `config`, `good-first-issue`
**Description:** Complete the Next.js app theming and layout shell.
- **Tasks:**
  - [ ] Add Google Font (Inter) to `layout.tsx` via `next/font`.
  - [ ] Setup dark mode CSS variables in `globals.css`.
  - [ ] Create `Navbar` component with logo, nav links, and wallet button.
  - [ ] Create `Footer` component with project links.
  - [ ] Add responsive Sidebar for mobile navigation.

### Issue #FE-2: Freighter Wallet Context Provider
**Priority:** Critical
**Labels:** `frontend`, `wallet`
**Description:** Implement a React Context for managing wallet state globally.
- **Tasks:**
  - [ ] Create `FreighterProvider` context in `src/contexts/FreighterContext.tsx`.
  - [ ] Implement `checkConnection()` on mount using `@stellar/freighter-api`.
  - [ ] Implement `connectWallet()` function.
  - [ ] Implement `disconnectWallet()` function.
  - [ ] Store `publicKey`, `isConnected`, `isLoading` in state.
  - [ ] Wrap the app in `FreighterProvider` in `layout.tsx`.

### Issue #FE-3: Wallet Connect Button
**Priority:** High
**Labels:** `frontend`, `ui`
**Description:** Build a smart wallet button with multiple states.
- **Tasks:**
  - [ ] **Disconnected state**: Show "Connect Wallet" with wallet icon.
  - [ ] **Loading state**: Show spinner during connection.
  - [ ] **Connected state**: Show truncated address (e.g., `GDKX…7F3B`).
  - [ ] **Error state**: Show error with retry button.
  - [ ] Add dropdown menu when connected: Copy Address, Disconnect.

### Issue #FE-4: Network Configuration & Soroban Client
**Priority:** High
**Labels:** `frontend`, `config`
**Description:** Complete the network config and create a Soroban RPC client wrapper.
- **Tasks:**
  - [ ] Implement `getSorobanServer()` using `@stellar/stellar-sdk`.
  - [ ] Add network switching support (Testnet / Mainnet).
  - [ ] Create `buildTransaction()` helper for Soroban contract calls.
  - [ ] Create `submitTransaction()` helper with error handling.
  - [ ] Add deployed contract IDs after deployment.

### Issue #FE-5: UI Component Library
**Priority:** Medium
**Labels:** `frontend`, `ui`, `good-first-issue`
**Description:** Create reusable UI primitives used across the dashboard.
- **Tasks:**
  - [ ] `Card` component with header, body, footer slots.
  - [ ] `Button` component with variants: primary, secondary, outline, danger.
  - [ ] `Modal` component with overlay and close button.
  - [ ] `Badge` component for status indicators (Pending, Approved, Active, etc.).
  - [ ] `Skeleton` loading component for data placeholders.
  - [ ] `Toast` notification component for transaction feedback.

---

## 🏦 Module 2: Treasury Dashboard (FE-6 to FE-10)

### Issue #FE-6: Treasury Overview Dashboard
**Priority:** High
**Labels:** `frontend`, `ui`, `treasury`
**Description:** Build the main treasury view showing vault status.
- **Tasks:**
  - [ ] Display current treasury balance (per token).
  - [ ] Show admin address and signer list.
  - [ ] Show current approval threshold.
  - [ ] Display proposal count and recent activity.
  - [ ] Wire up `useTreasury()` hook with real contract calls.

### Issue #FE-7: Treasury Deposit Modal
**Priority:** High
**Labels:** `frontend`, `ui`, `treasury`
**Description:** Build a modal for depositing tokens into the treasury.
- **Tasks:**
  - [ ] Token selector dropdown.
  - [ ] Amount input with validation (min/max).
  - [ ] Show estimated gas fee.
  - [ ] Build Soroban XDR for `deposit()` contract call.
  - [ ] Handle sign + submit flow via Freighter.
  - [ ] Show success/error toast on completion.

### Issue #FE-8: Withdrawal Request Flow
**Priority:** Critical
**Labels:** `frontend`, `soroban`, `treasury`
**Description:** Implement the multi-step withdrawal request UI.
- **Tasks:**
  - [ ] "New Withdrawal" form: token, recipient, amount, memo.
  - [ ] Build XDR for `create_withdrawal()` contract call.
  - [ ] List pending withdrawals with approval count indicators.
  - [ ] "Approve" button for signers (builds `approve_withdrawal()` XDR).
  - [ ] "Execute" button once threshold is met.

### Issue #FE-9: Signer Management Panel
**Priority:** Medium
**Labels:** `frontend`, `ui`, `treasury`
**Description:** Admin panel for managing treasury signers.
- **Tasks:**
  - [ ] Display current signer list with addresses.
  - [ ] "Add Signer" form with address input.
  - [ ] "Remove Signer" action with confirmation.
  - [ ] "Update Threshold" input with validation.
  - [ ] Only visible to admin wallet.

### Issue #FE-10: Treasury Transaction History
**Priority:** Medium
**Labels:** `frontend`, `data`, `treasury`
**Description:** Display historical deposits, withdrawals, and signer changes.
- **Tasks:**
  - [ ] Timeline/list view of treasury events.
  - [ ] Filter by event type (Deposit, Withdrawal, Signer change).
  - [ ] Show details: amount, addresses, timestamp, status.
  - [ ] Pagination for large histories.

---

## 💸 Module 3: Payroll Dashboard (FE-11 to FE-15)

### Issue #FE-11: Stream Creation Form
**Priority:** High
**Labels:** `frontend`, `ui`, `payroll`
**Description:** Build the form for creating new payment streams.
- **Tasks:**
  - [ ] Recipient address input with validation.
  - [ ] Token selector.
  - [ ] Total amount input.
  - [ ] Start date/time picker.
  - [ ] End date/time picker (with duration preview).
  - [ ] Show calculated rate per second/hour/day.
  - [ ] Build XDR for `create_stream()` contract call.

### Issue #FE-12: Active Streams List
**Priority:** High
**Labels:** `frontend`, `ui`, `payroll`
**Description:** Display all active streams with live progress.
- **Tasks:**
  - [ ] Card view for each stream.
  - [ ] Progress bar showing % streamed.
  - [ ] Live ticker showing claimable amount (updating every second).
  - [ ] Status badge: Active, Paused, Cancelled, Completed.
  - [ ] Filter: "Sent by me" vs "Received by me".

### Issue #FE-13: Stream Claim Flow
**Priority:** High
**Labels:** `frontend`, `soroban`, `payroll`
**Description:** Enable recipients to claim accrued tokens.
- **Tasks:**
  - [ ] Show current claimable balance with real-time updates.
  - [ ] "Claim" button builds `claim()` XDR.
  - [ ] Confirmation modal showing exact amount.
  - [ ] Success animation with claimed amount.
  - [ ] Update stream card after claim.

### Issue #FE-14: Payroll Analytics Chart
**Priority:** Medium
**Labels:** `frontend`, `ui`, `payroll`
**Description:** Visualize payroll distribution over time.
- **Tasks:**
  - [ ] Line chart: total payroll disbursed over time.
  - [ ] Bar chart: per-employee distribution.
  - [ ] Summary stats: total streams, total disbursed, active streams.
  - [ ] Use a lightweight chart library (e.g., Recharts or Chart.js).

### Issue #FE-15: Batch Payroll Creation
**Priority:** Low
**Labels:** `frontend`, `feature`, `payroll`
**Description:** Allow creating multiple streams from a CSV upload.
- **Tasks:**
  - [ ] CSV file upload component.
  - [ ] Parse CSV: recipient, amount, start, end.
  - [ ] Preview table of streams to be created.
  - [ ] Single "Create All" button for batch stream creation.

---

## ⏳ Module 4: Vesting Dashboard (FE-16 to FE-19)

### Issue #FE-16: Vesting Schedule Builder
**Priority:** High
**Labels:** `frontend`, `ui`, `vesting`
**Description:** Form for creating new vesting schedules.
- **Tasks:**
  - [x] Beneficiary address input. (@brightpixel-dev - 2026-07-23, issue #63)
  - [x] Token selector and total amount. (@brightpixel-dev - 2026-07-23, issue #63 — free-text contract id input, matching the existing payroll form's convention)
  - [x] Start date picker. (@brightpixel-dev - 2026-07-23, issue #63)
  - [x] Cliff duration input (months/days). (@brightpixel-dev - 2026-07-23, issue #63 — days)
  - [x] Total vesting duration input. (@brightpixel-dev - 2026-07-23, issue #63 — days)
  - [x] Label selector: "Team", "Advisor", "Seed", "Custom". (@brightpixel-dev - 2026-07-23, issue #63)
  - [x] Revocable toggle switch. (@brightpixel-dev - 2026-07-23, issue #63)
  - [ ] Visual preview of vesting timeline. — Implemented as a data preview (total/cliff-unlock/cliff/full-vest), not a graphical timeline; see FE-17 note below.

### Issue #FE-17: Vesting Timeline Visualization
**Priority:** High
**Labels:** `frontend`, `ui`, `vesting`
**Description:** Visual representation of vesting progress.
- **Tasks:**
  - [ ] Horizontal timeline bar showing cliff, linear vesting, and current position. — Not built as a segmented timeline; issue #63 shipped a single-color vested/total progress bar instead (ScheduleCard.tsx). Left open as a real follow-up if the fuller visualization is still wanted.
  - [ ] Markers for: start, cliff date, current date, end date. — Shown as text in an expandable detail panel, not as timeline markers.
  - [ ] Tooltip showing amounts at each point. — Not built.
  - [ ] Color coding: locked (gray), vested (green), claimed (blue). — Approximated via separate stat tiles (Claimed / Claimable / Not yet vested), not a color-coded bar.
  - [x] Wire up with `get_progress()` contract query. (@brightpixel-dev - 2026-07-23, issue #63 — polled every ~3s while a schedule is Active)

### Issue #FE-18: Vesting Claim Modal
**Priority:** High
**Labels:** `frontend`, `soroban`, `vesting`
**Description:** Allow beneficiaries to claim vested tokens.
- **Tasks:**
  - [x] Show vesting progress: total, vested, claimed, claimable. (@brightpixel-dev - 2026-07-23, issue #63)
  - [x] "Claim" button with amount preview. (@brightpixel-dev - 2026-07-23, issue #63)
  - [x] Build XDR for `claim()` contract call. (@brightpixel-dev - 2026-07-23, issue #63)
  - [ ] Success animation with claimed amount. — Success is surfaced via the shared TxStatus component (same as payroll's claim/cancel), no distinct animation; matches existing project convention rather than adding a one-off animation just for vesting.
  - [x] Disable claim if nothing claimable or before cliff. (@brightpixel-dev - 2026-07-23, issue #63 — also distinguishes "before cliff" from "nothing to claim" in the message, since the contract returns the same error code for both)

### Issue #FE-19: Admin Revoke Panel
**Priority:** Medium
**Labels:** `frontend`, `ui`, `vesting`
**Description:** Admin/grantor interface to revoke vesting schedules.
- **Tasks:**
  - [x] List revocable schedules with revoke button. (@brightpixel-dev - 2026-07-23, issue #63 — gated on isGrantor && schedule.revocable, since the contract returns the same Unauthorized code for "not revocable" as "not your schedule")
  - [x] Confirmation modal with impact summary (tokens returned to grantor). (@brightpixel-dev - 2026-07-23, issue #63)
  - [x] Build XDR for `revoke()` contract call. (@brightpixel-dev - 2026-07-23, issue #63)
  - [x] Show post-revocation state clearly. (@brightpixel-dev - 2026-07-23, issue #63 — status badge updates to Revoked after refresh)

---

## 🗳️ Module 5: Governance Dashboard (FE-20 to FE-23)

### Issue #FE-20: Proposal Creation Form
**Priority:** High
**Labels:** `frontend`, `ui`, `governance`
**Description:** Build the form for submitting budget proposals.
- **Tasks:**
  - [ ] Title input (short description).
  - [ ] Token selector and amount requested.
  - [ ] Recipient address input.
  - [ ] Justification text area (stored off-chain or as memo).
  - [ ] Build XDR for `create_proposal()` contract call.
  - [ ] Preview proposal before submission.

### Issue #FE-21: Voting Interface
**Priority:** High
**Labels:** `frontend`, `soroban`, `governance`
**Description:** Implement the voting UI for DAO members.
- **Tasks:**
  - [ ] Three voting buttons: Yes ✅, No ❌, Abstain ⚪.
  - [ ] Show current vote tally with progress bars.
  - [ ] Disable voting after period expires.
  - [ ] Show "You voted: X" after voting.
  - [ ] Build XDR for `vote()` contract call.

### Issue #FE-22: Proposal List & Detail View
**Priority:** Medium
**Labels:** `frontend`, `ui`, `governance`
**Description:** List and detail views for all proposals.
- **Tasks:**
  - [ ] Card grid/list of proposals with status badges.
  - [ ] Filter by status: Active, Approved, Rejected, Executed.
  - [ ] Detail view: full proposal info, vote records, timeline.
  - [ ] Countdown timer for active proposals.

### Issue #FE-23: Proposal Execution UI
**Priority:** Medium
**Labels:** `frontend`, `soroban`, `governance`
**Description:** UI for executing approved proposals.
- **Tasks:**
  - [ ] Only admins see the "Execute" button.
  - [ ] Build XDR for `execute()` contract call.
  - [ ] Show execution confirmation with fund amounts.
  - [ ] Update proposal status to "Executed" after success.

---

## ✨ Module 6: Polish & Accessibility (FE-24 to FE-25)

### Issue #FE-24: Mobile Responsiveness
**Priority:** Medium
**Labels:** `frontend`, `ui`, `responsive`
**Description:** Ensure the dashboard works well on mobile devices.
- **Tasks:**
  - [ ] Stack columns on screens < 768px.
  - [ ] Fix modal widths on mobile.
  - [ ] Collapsible sidebar for mobile navigation.
  - [ ] Touch-friendly button sizes.
  - [ ] Test on iPhone SE and Android viewport sizes.

### Issue #FE-25: Accessibility (a11y) Audit
**Priority:** Medium
**Labels:** `frontend`, `accessibility`, `good-first-issue`
**Description:** Improve accessibility across the dashboard.
- **Tasks:**
  - [ ] Add `aria-labels` to all interactive elements.
  - [ ] Ensure keyboard navigation works for all flows.
  - [ ] Add `role` attributes to custom components.
  - [ ] Ensure sufficient color contrast ratios.
  - [ ] Add screen reader announcements for transaction status changes.

---

## ✅ Completed Issues
*(Move completed items here)*
