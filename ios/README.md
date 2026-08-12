# Cloudflare OS for iOS

This target is a native SwiftUI shell for the private Cloudflare OS deployment at
`https://os.ignitabull.org`. It intentionally reuses the production Workshop UI and backend so
WebSocket RPC, gadgets, gatekeepers, approvals, and Cloudflare Access continue to share one source
of truth.

## Requirements

- Xcode 16 or newer with an iOS 17+ Simulator runtime
- Access to `https://os.ignitabull.org`

## Run

1. Open `CloudflareOS.xcodeproj` in Xcode.
2. Select the **CloudflareOS** scheme and an iPhone Simulator.
3. Press **Run**.
4. Complete Cloudflare Access sign-in inside the app when prompted.

The app keeps website data in the default persistent `WKWebsiteDataStore`, so the Access session
survives normal app relaunches. Pop-up authentication flows open in an in-app browser layer backed
by the same data store, so connector OAuth can retain its real popup contract and return its cookies
to the app rather than stranding them in Safari.

## Configuration

`CloudflareOSBaseURL` in `CloudflareOS/Resources/Info.plist` controls the deployment URL. Keep it on
HTTPS in release builds. The app also accepts these deep links:

- `https://os.ignitabull.org/<path>`
- `cloudflareos://open?path=/<path>`

## Distribution

Set the signing team in Xcode under **Signing & Capabilities**, choose a unique bundle identifier if
needed, then archive with **Product > Archive** for TestFlight or private distribution.
