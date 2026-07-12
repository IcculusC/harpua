---
"@harpua/langgraph": minor
---

`maxWallMs` now guards UNATTENDED runaway instead of raw wall-clock: when a
`Command({ resume })` arrives for a thread suspended at an `interrupt()`, the
graph facade shifts the reserved `loop.startedAt` anchor forward by the time
the run spent suspended (measured from the halted checkpoint's timestamp), so
a human deliberating at an approval prompt no longer burns the wall budget —
previously one slow approval exited the resumed turn `budget:wall`. An active
overrun (a tool or model genuinely consuming wall time) still trips the cap.
The credit is applied per resume, accumulates across multiple approvals on a
thread, and is skipped entirely for non-`Command` input, graphs without the
agent `loop` channel, and threads with no pending interrupt.
