# Firebase (FCM) setup for push notifications: Android and iOS

Who does what:

| Part | Who | Section |
|---|---|---|
| Firebase project and service account | Whoever owns the Google/Firebase account | 1, 2 |
| Server settings and deploy | Backend / DevOps | 3 |
| Android app | Mobile developer | 4 |
| iOS app and Apple key | Mobile developer, with the Apple Developer account owner | 5 |
| Testing | Everyone | 6 |

Nothing in the app can receive a push until sections 1 to 3 are done. The backend code is built and on `main`; it just needs to be deployed with these credentials.

## 1. Create the Firebase project (once)

1. Go to https://console.firebase.google.com and sign in with the company Google account (not a personal one, so access survives staff changes).
2. Click **Add project**, name it (for example `finskool`), and finish the wizard. Google Analytics is optional; you do not need it for push.
3. Open **Project settings** (the gear icon).

## 2. Create the server key (service account)

The backend uses this to send pushes. It is a secret: anyone who has it can send pushes to your members.

1. Project settings, tab **Service accounts**.
2. Click **Generate new private key**, then confirm. A `.json` file downloads.
3. Keep it somewhere safe (a password manager or your secrets store). **Never commit it to git, never put it in the app.**
4. Make sure the **Firebase Cloud Messaging API (V1)** is enabled: Project settings, tab **Cloud Messaging**. It should say "enabled". If it says disabled, click the three dots, open it in Google Cloud and click **Enable**.

## 3. Backend settings (server)

The backend reads one of these environment variables. Use the first one on Docker.

| Variable | Value |
|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | The whole JSON file as **one line** |
| `FCM_SERVICE_ACCOUNT_FILE` | Or: the path to the JSON file on the server |

**Steps (Docker, as in `docker/docker-compose.production.yml`)**

1. Turn the file into one line:
   ```bash
   jq -c . firebase-service-account.json
   ```
2. In the server's `.env`, add it **without quotes**:
   ```
   FCM_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"finskool",...}
   ```
   (Docker's `env_file` does not strip quotes, so do not wrap the value in `'` or `"`.)
3. Run the database migrations on the production database (`prisma migrate deploy`, as you do for other releases). The push release adds `20261021120000_add_push_notifications`. The deploy script does not run migrations by itself, so confirm it was applied.
4. Restart the **backend, worker and cron** containers so all three read the new variable. The worker is the one that sends pushes.
5. Check the worker logs. With a bad or missing key you will see `FCM is not configured` or `invalid service account credentials`. With nothing wrong there is no message at all.

If neither variable is set, the app still works: pushes are skipped and logged, and the in-app inbox and live socket keep working.

## 4. Android

### In Firebase
1. Project overview, **Add app**, choose the **Android** icon.
2. **Package name:** must exactly match the app's `applicationId` (in `android/app/build.gradle`, for example `com.finskool.app`). It cannot be changed later.
3. Nickname is optional. The SHA-1 key is **not** needed for push (only for Google sign-in).
4. Download **`google-services.json`**.

### In the Flutter app
1. Put `google-services.json` in `android/app/`.
2. Add the Google services plugin:
   - `android/settings.gradle(.kts)`: `id("com.google.gms.google-services") version "4.4.2" apply false`
   - `android/app/build.gradle(.kts)`: `id("com.google.gms.google-services")`
3. Add the packages:
   ```bash
   flutter pub add firebase_core firebase_messaging flutter_local_notifications
   ```
   or run `flutterfire configure`, which does most of the above automatically.
4. In `main()`: `await Firebase.initializeApp();`
5. **Android 13 and newer** needs the runtime permission, so request it (the app flow in `mobile-push-integration.md`, section 3, does this with `requestPermission()`), and add to `AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
   ```
6. Add a background handler (top-level function) so messages arriving while the app is closed are handled:
   ```dart
   @pragma('vm:entry-point')
   Future<void> _bg(RemoteMessage m) async { await Firebase.initializeApp(); }
   FirebaseMessaging.onBackgroundMessage(_bg);
   ```
7. Android needs no extra server setup beyond section 2.

## 5. iOS

iPhones need Apple to be involved, so there are more steps. You need the **Apple Developer Program** membership (paid) and a **real iPhone** (simulators are unreliable for push).

### 5a. Create the Apple push key (once)
1. Go to https://developer.apple.com/account, **Certificates, Identifiers & Profiles**, **Keys**, **+**.
2. Name it (for example `FinSkool Push`), tick **Apple Push Notifications service (APNs)**, continue, register.
3. **Download the `.p8` file immediately** (Apple lets you download it only once). Write down the **Key ID** (10 characters) and your **Team ID** (top right of the Apple account page, or Membership details).
4. Keep the `.p8` safe, like the service account.

### 5b. Give the key to Firebase
1. Firebase console, Project settings, tab **Cloud Messaging**, section **Apple app configuration**.
2. **APNs authentication key**, **Upload**. Choose the `.p8`, enter the **Key ID** and **Team ID**. Upload both for development and production if it shows two slots (one key works for both).

### 5c. Register the app in Firebase
1. Project overview, **Add app**, **iOS** icon.
2. **Apple bundle ID:** must exactly match the Xcode bundle identifier (for example `com.finskool.app`).
3. Download **`GoogleService-Info.plist`**.

### 5d. In the Flutter app (Xcode)
1. Open `ios/Runner.xcworkspace` in Xcode.
2. Drag `GoogleService-Info.plist` into the **Runner** folder (tick "Copy items if needed" and the Runner target).
3. **Signing & Capabilities**, **+ Capability**, add:
   - **Push Notifications**
   - **Background Modes**, then tick **Remote notifications**
4. Make sure the app's **App ID** in the Apple developer account has Push Notifications enabled (Xcode does this automatically with "Automatically manage signing").
5. Same Dart packages and `Firebase.initializeApp()` as Android (section 4, steps 3, 4, 6).
6. Ask for permission with `FirebaseMessaging.instance.requestPermission()`. On iOS the system prompt appears once; if the user taps "Don't Allow" they must enable it in Settings.
7. To show a banner while the app is open (foreground), add `flutter_local_notifications`. By default iOS shows nothing in the foreground.
8. Build and run on a **real device**.

## 6. Test it end to end

1. **Server side:** check the worker log has no "FCM is not configured" line after a push attempt.
2. **Token reaches the server:** log in on the phone, then check that the member's session now has a token:
   ```sql
   select user_id, left(fcm_token, 12) as token, fcm_token_updated_at, app_version
   from mobile_sessions where user_id = '<member id>';
   ```
   No row value means the app did not call `PUT /api/v1/mobile/push-token` (or the login `fcmToken`).
3. **Send a real push, quickest way:** in the Firebase console open **Messaging**, **Create your first campaign**, **Firebase Notification messages**, then **Send test message**, paste the phone's FCM token and send. If this arrives, Firebase and the phone are set up correctly.
4. **Through the product:** close the app on the phone, then from the admin dashboard reply to that member's ticket. A banner should appear within a few seconds. Tapping it should open the ticket.
5. Walk through the checklist in `docs/mobile-push-integration.md`, section 9.

## 7. If something does not arrive

| Symptom | Likely cause |
|---|---|
| Nothing on either platform | Service account variable missing or malformed (check the worker logs); worker container not running; member has `push_enabled` false |
| Android works, iPhone does not | APNs key not uploaded, wrong Key ID or Team ID, Push Notifications capability missing, or testing on a simulator |
| Works in debug, not in release | Release build is missing `google-services.json` or `GoogleService-Info.plist`, or uses a different package or bundle ID than the one registered |
| Test message from Firebase arrives, product push does not | The token is not stored on the server (check the SQL above), or the member is logged in on another phone (one device per member) |
| Token disappears after a push | Firebase said the token is dead (app uninstalled or reinstalled); the app registers a new one on next launch |
| Push arrives but tapping does nothing | The app is not reading `message.data` (see the routing example in `mobile-push-integration.md`, section 6) |

## 8. Keep in mind

- **One Firebase project can serve both Android and iOS apps**, and you can add a second project (for example `finskool-staging`) with its own service account for testing. Use a different `FCM_SERVICE_ACCOUNT_JSON` per environment.
- **Rotating the service account key:** create a new key in Firebase, update the variable, restart the three containers, then delete the old key in Google Cloud (IAM, Service accounts).
- **Do not share the `.p8` or the service account JSON in chat or email.** If one leaks, revoke it (Apple developer Keys page, or Google Cloud IAM) and create a new one.
- **Costs:** FCM itself is free with no sending limit that matters at this scale.
