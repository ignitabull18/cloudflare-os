# Cloudflare OS mobile

This is a thin Expo shell for the hosted Cloudflare OS at `https://os.ignitabull.org/operations`.
The web deployment remains the source of truth, so the phone works while the MacBook is offline.

## Run on a phone

```sh
pnpm --filter @ignitabull/cloudflare-os-mobile start
```

Scan the QR code with Expo Go. The app uses only Expo Go-compatible libraries.

## Build for TestFlight

```sh
cd apps/mobile
pnpm exec eas login
pnpm exec eas build:configure
pnpm exec eas build --platform ios --profile production
pnpm exec eas submit --platform ios --profile production
```

EAS performs the iOS build on Expo's macOS builders. An Expo account and Apple Developer account
are required, but Xcode does not need to be installed locally.
