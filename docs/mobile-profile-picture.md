# Mobile: change the profile picture (3 calls)

Changing the picture takes three calls. The photo itself goes straight to storage, not through our API.

```
1. GET   /api/v1/auth/me/avatar/upload-url   ->  uploadUrl + publicUrl
2. PUT   <uploadUrl>                         ->  the image bytes (storage, not our API)
3. PATCH /api/v1/auth/me/avatar              ->  save publicUrl on the account
```

Calls 1 and 3 are authenticated like every other mobile call: send the `mobile_session_id` cookie from login. Call 2 is **not** authenticated (the link is already signed); do not send the cookie to it.

## Rules (the server enforces them)

- **JPG, PNG or WebP only.** Judged by the file's real content, not just its name. GIF, SVG, PDF and anything else is refused.
- **5 MB at most.**
- The file name must end in `.jpg`, `.jpeg`, `.png` or `.webp`.

A refused picture is deleted from storage, so nothing is left behind. The app should still check the same things before it uploads, to give the member a quick message, and should **resize to about 512 x 512 px** first: it uploads faster and loads faster everywhere. (Size in pixels is not checked by the server.)

## Step 1: ask for an upload link

```
GET /api/v1/auth/me/avatar/upload-url?filename=me.jpg&sizeBytes=183204
```

`filename` is required. `sizeBytes` (the file's size in bytes) is optional but recommended: if it is over 5 MB the server refuses right away, before anything is uploaded.

Response `200`:

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://community.finskool21.in/assets/finskool/avatars/3f1c....jpg?X-Amz-Algorithm=...&X-Amz-Signature=...",
    "publicUrl": "https://community.finskool21.in/assets/finskool/avatars/3f1c....jpg"
  }
}
```

- `uploadUrl` is where you send the image. It is valid for **5 minutes**.
- `publicUrl` is the address the picture will have afterwards. Keep it for step 3.
- Errors:
  - `401` not logged in.
  - `422` missing `filename`.
  - `400` with `code: "AVATAR_TYPE_INVALID"`: the file name is not a `.jpg`, `.jpeg`, `.png` or `.webp`.
  - `400` with `code: "AVATAR_TOO_LARGE"`: `sizeBytes` is over 5 MB.

## Step 2: upload the image

```
PUT <uploadUrl>
Content-Type: image/jpeg
<raw image bytes as the body>
```

- Send the **raw bytes** as the body (not multipart, not base64).
- Set `Content-Type` to match the file: `image/jpeg`, `image/png` or `image/webp`.
- Use the `uploadUrl` exactly as it came back, with all its query parameters. Do not add the cookie or an `Authorization` header.
- The `Content-Type` must be the real type of the image. A picture uploaded with a different type (for example `text/html`) is refused in step 3.
- Success is `200` with an empty body.
- If it fails with `403` or `400` after a while, the link expired: go back to step 1 for a new one.

## Step 3: tell the server to use it

```
PATCH /api/v1/auth/me/avatar
Content-Type: application/json

{ "avatarUrl": "<publicUrl from step 1>" }
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...", "name": "Priya Sharma", "phone": "+91...", "email": "priya@example.com",
      "role": "member", "isSuperAdmin": false,
      "avatarUrl": "https://community.finskool21.in/assets/finskool/avatars/3f1c....jpg",
      "postNotificationsEnabled": true
    }
  }
}
```

- Use `user.avatarUrl` to show the new picture.
- The previous picture is deleted from storage automatically.
- The server checks the stored file now (type, size, that it really is the file you uploaded). Errors, all `400` with a `code`:

  | `code` | Meaning | What the app does |
  |---|---|---|
  | `AVATAR_NOT_UPLOADED` | Nothing was uploaded at that address (step 2 failed or the link expired) | Start again from step 1 |
  | `AVATAR_TOO_LARGE` | The file is over 5 MB | Ask for a smaller picture |
  | `AVATAR_TYPE_INVALID` | Not a real JPG, PNG or WebP | Ask for a different picture |
  | `AVATAR_URL_INVALID` | `avatarUrl` is not the `publicUrl` from step 1 | Use the `publicUrl` exactly as returned |

  Other errors: `401` not logged in, `422` `avatarUrl` is not a valid URL.
- Only do step 3 after step 2 succeeded.

The picture also appears in `GET /api/v1/auth/mobile/me` (`data.user.avatarUrl`), and next to the member's name in posts and comments.

## Example (Dart with Dio)

```dart
Future<String> updateProfilePicture(Dio api, File image) async {
  // 1. ask for an upload link
  final link = await api.get('/api/v1/auth/me/avatar/upload-url',
      queryParameters: {'filename': 'me.jpg'});
  final uploadUrl = link.data['data']['uploadUrl'] as String;
  final publicUrl = link.data['data']['publicUrl'] as String;

  // 2. upload the bytes to storage (a plain Dio, no cookies, no auth headers)
  await Dio().put(
    uploadUrl,
    data: image.openRead(),
    options: Options(headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': await image.length(),
    }),
  );

  // 3. tell the server to use it
  final saved = await api.patch('/api/v1/auth/me/avatar', data: {'avatarUrl': publicUrl});
  return saved.data['data']['user']['avatarUrl'] as String;
}
```

## Checklist

1. Pick a photo, resize it, and check it is JPG, PNG or WebP and under 5 MB. Also try a GIF, a file renamed to `.jpg` that is not an image, and a picture over 5 MB: each should be refused with the codes above.
2. Do the three calls in order. Show a progress indicator during step 2.
3. After step 3, update the picture everywhere in the app (profile and comments).
4. Try it with a bad network: if step 2 fails, do not call step 3; offer a retry from step 1.
5. Wait more than 5 minutes between step 1 and step 2: you should get an error and the app should start again from step 1.

There is no call yet to remove the picture; the app can only replace it.
