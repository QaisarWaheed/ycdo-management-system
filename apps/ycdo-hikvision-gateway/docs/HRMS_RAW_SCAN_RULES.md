# HRMS `/attendance/raw-scan` server rules

The gateway only guarantees reliable delivery. The HRMS is authoritative because it also knows shifts, leave, manual HR attendance, admin self-attendance, 24-hour duties and other business state.

## Input

```json
{
  "biometricId": "124",
  "timestamp": "2026-08-22T08:03:17+05:00",
  "deviceId": "YCDO-CENTRAL-HOSPITAL",
  "deviceStatus": "checkIn",
  "serialNo": "827361"
}
```

Supported `deviceStatus` values:

- `checkIn`
- `checkOut`
- `overtimeIn`
- `overtimeOut`

Face/fingerprint/card is an authentication method only. It must not create a different attendance state machine for the same employee.

## Transport idempotency

If `serialNo` exists, enforce a unique key on `(deviceId, serialNo)`.

If already processed, return HTTP 200:

```json
{ "ok": true, "idempotent": true, "accepted": false, "reason": "DEVICE_EVENT_ALREADY_PROCESSED" }
```

Do not return 409 for a replay.

## Check In

1. Resolve employee by `biometricId`.
2. Resolve the duty/attendance record that the timestamp belongs to, including cross-midnight shifts.
3. If no check-in exists, write the original device timestamp and mark attendance present according to HRMS policy.
4. If check-in already exists, do not overwrite it.
5. Return HTTP 200 with `accepted:false, reason:"ALREADY_CHECKED_IN"` for the second genuine scan.

## Check Out

1. Resolve the same duty/session.
2. A check-in must exist first.
3. If no check-in exists, do not create an orphan checkout; return HTTP 200 with `accepted:false, reason:"CHECKOUT_WITHOUT_CHECKIN"`.
4. If checkout is empty, stamp the device timestamp.
5. If checkout already exists, do not overwrite it; return `ALREADY_CHECKED_OUT`.

## Overtime In

1. Resolve employee and applicable overtime policy/session.
2. If no overtime-in exists and the employee is eligible, stamp it.
3. If already active, do not overwrite; return `OVERTIME_ALREADY_STARTED`.
4. Whether normal duty must already be completed is a policy decision owned by HRMS, not the gateway.

## Overtime Out

1. Overtime-in must exist first.
2. If absent, return `OVERTIME_OUT_WITHOUT_IN`.
3. If overtime-out is empty, stamp it.
4. If already present, do not overwrite; return `OVERTIME_ALREADY_COMPLETED`.

## Recommended logical outcomes

- `ACCEPTED`
- `DEVICE_EVENT_ALREADY_PROCESSED`
- `ALREADY_CHECKED_IN`
- `CHECKOUT_WITHOUT_CHECKIN`
- `ALREADY_CHECKED_OUT`
- `OVERTIME_ALREADY_STARTED`
- `OVERTIME_OUT_WITHOUT_IN`
- `OVERTIME_ALREADY_COMPLETED`
- `EMPLOYEE_NOT_FOUND`
- `DEVICE_NOT_REGISTERED`
- `INVALID_ATTENDANCE_STATUS`
- `NO_DUTY_FOR_TIMESTAMP`

Business-rule rejection should normally be returned as HTTP 200 with an explicit `accepted:false` result. HTTP 4xx/5xx should be reserved for malformed/authentication/server failures so transport retry behavior stays predictable.
