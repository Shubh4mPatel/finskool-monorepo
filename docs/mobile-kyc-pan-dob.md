# Date of birth and PAN (mobile)

The server keeps one flag, `completed`. The app checks it and asks for date of birth and PAN until it is `true`. Once it is `true` the app never asks or sends them again, unless the member chooses to edit.

All three calls need the logged-in mobile session cookie. Base path: `/api/v1/auth/mobile`.

## 1. Check the flag (every app start, after login)

`GET /me/kyc`

```json
{ "success": true, "data": { "completed": false, "available": true, "dateOfBirth": null, "panMasked": null } }
```

- `available: false` -> the server cannot save these details right now (a server setting is missing). Do not show the form yet; try again on a later launch.
- `completed: false` (and `available: true`) -> show the form (step 2). Ask again on every launch (or on a sensible reminder schedule) until it is true.
- `completed: true` -> do nothing. `dateOfBirth` and `panMasked` (for example `XXXXXX234F`) are there only to pre-fill an edit screen. The full PAN is never returned.

## 2. Send the details (first time)

`POST /me/kyc`

```json
{ "dateOfBirth": "1995-04-12", "panNumber": "ABCDE1234F" }
```

Returns `201 { "success": true, "data": { "panSubmitted": true } }`. Call `GET /me/kyc` afterwards (or just set the local flag).

- `dateOfBirth`: `YYYY-MM-DD`, a real past date, 1900-01-01 or later.
- `panNumber`: 5 letters, 4 digits, 1 letter. Lower case is accepted.
- `409 KYC_ALREADY_SUBMITTED`: they were saved earlier. Use the edit call; nothing was changed.
- `422`: invalid PAN or date. Show the message from the response.

## 3. Edit

`PUT /me/kyc`, send one or both fields:

```json
{ "panNumber": "PQRST6789U" }
```

Returns `200` with the same body as `GET /me/kyc`, already updated.

- `409 KYC_NOT_SUBMITTED`: nothing was submitted yet, use the first-time call.
- `422`: neither field sent, or a field is invalid.

`GET /auth/mobile/me` still returns `panSubmitted` and `dateOfBirth`, so existing screens keep working.

## Security notes

The PAN is stored encrypted (AES-256-GCM, key `PAN_ENCRYPTION_KEY` on the server) and is never logged or returned in full. The app should send it only over HTTPS, never store it on the device, and never write it to logs.

## Rules the server enforces

| Field | Accepted | Rejected (422) |
|---|---|---|
| `panNumber` | 5 letters + 4 digits + 1 letter. Spaces around it and lower case are fixed for you (`  abcde1234f ` is saved as `ABCDE1234F`) | too short or long, digits first, a space inside, accented letters, empty, a number / null / array instead of text |
| `dateOfBirth` | `YYYY-MM-DD`, a real calendar date (2000-02-29 is fine), from 1900-01-01 up to today | 2001-02-29, 2026-02-30, month 13, a future date, before 1900, `95-04-12`, `1995/04/12`, `12-04-1995`, `1995-4-12`, empty |

Other behaviour the app should expect:

| Situation | Response |
|---|---|
| No session cookie | `401` |
| Suspended or deleted member | `401` (`SESSION_INVALIDATED`), the app logs the member out |
| Web login instead of a mobile session | `403 MOBILE_ONLY` |
| Body is not valid JSON | `400 INVALID_JSON` |
| The server has no encryption key set | `503 KYC_UNAVAILABLE` ("Saving your details is not available right now."). Show it as is; the member did nothing wrong |
| Extra fields in the body (for example `role`) | ignored, they cannot change anything else |
| Two taps at the same time on the first submit | one `201`, the others `409 KYC_ALREADY_SUBMITTED`; nothing is lost or doubled |
| Edits at the same time | all succeed, the last one wins |

## How it is stored

`users.date_of_birth` (a date) and `users.pan_encrypted`. The PAN is encrypted with AES-256-GCM and a fresh random IV each time, so saving the same PAN twice gives different ciphertext. The database row never holds the plain PAN, and neither does the backend log. If the key on the server is ever wrong or a value is damaged, `GET /me/kyc` still answers (`completed: true`, `panMasked: null`) and an edit with a new PAN repairs the row.

Server setting: `PAN_ENCRYPTION_KEY` (64 hex characters, `openssl rand -hex 32`). **Do not change it after members have submitted**: old values could no longer be read. Keep a backup of it.

## Test results (2026-11-03, local server, real Postgres and Redis)

50 checks passed, run against 6 members with their own sessions:

- 4 members submitted different values; each flag showed only that member's date and masked PAN; a member who had not submitted stayed `completed: false`.
- 15 simultaneous first submits gave exactly one `201` and 14 `409`; 10 simultaneous edits all succeeded.
- 11 PAN formats and 4 wrong types, and 13 date formats (leap day, impossible dates, boundaries), gave the accept / reject results in the table above.
- Edit before the first submit gave `409 KYC_NOT_SUBMITTED`; a second first-submit gave `409` and changed nothing; editing only the date, only the PAN, or both worked and left the other value alone.
- Web login gave `403`, no session gave `401`, a suspended member gave `401`.
- The stored value is `v1:iv:tag:ciphertext`; no plain PAN in the row or in the log; a damaged ciphertext did not break the flag and was repaired by an edit.

One bug found and fixed while testing: a request whose body was not valid JSON returned `500` on every endpoint. It now returns `400 INVALID_JSON` (and `413` for a body that is too large).

## Open points

- An edit needs only the logged-in session. Asking for the password or an OTP before a PAN change is possible if you want it.
- There is no limit on how often a member can edit, and no history of old values.
- Today's date is accepted as a date of birth; there is no minimum age.

## When the member sees an error after entering the details

| What the app gets | Cause | Fix |
|---|---|---|
| `422 Validation failed` with `errors.dateOfBirth` or `errors.panNumber` | The value is in the wrong shape. Show `errors.<field>[0]`, which says what to fix | Send `dateOfBirth` as plain `YYYY-MM-DD` (not `12/04/1995`, not a timestamp such as `1995-04-12T00:00:00.000Z`: a timestamp built from a local midnight can be the day before in UTC) and `panNumber` as 10 characters with no spaces inside |
| `503 KYC_UNAVAILABLE` | `PAN_ENCRYPTION_KEY` is not set on the server, or is still the placeholder from `.env.example` | Server: generate a key (`openssl rand -hex 32`), put it in the server `.env`, recreate the backend container. The log line is `kyc: PAN_ENCRYPTION_KEY is missing...` |
| `409 KYC_ALREADY_SUBMITTED` | The details were saved before | Use the edit call |
| `403 MOBILE_ONLY` | The call was made with a web login (for example from Postman with the dashboard token) | Use the mobile session cookie |
| `401` | No session, or the member was suspended | Log in again |
