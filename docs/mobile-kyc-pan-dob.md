# Date of birth and PAN (mobile)

The server keeps one flag, `completed`. The app checks it and asks for date of birth and PAN until it is `true`. Once it is `true` the app never asks or sends them again, unless the member chooses to edit.

All three calls need the logged-in mobile session cookie. Base path: `/api/v1/auth/mobile`.

## 1. Check the flag (every app start, after login)

`GET /me/kyc`

```json
{ "success": true, "data": { "completed": false, "dateOfBirth": null, "panMasked": null } }
```

- `completed: false` -> show the form (step 2). Ask again on every launch (or on a sensible reminder schedule) until it is true.
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
