import SwiftUI

struct RootView: View {
    let browser: BrowserModel

    var body: some View {
        ZStack(alignment: .top) {
            Color(.systemBackground)
                .ignoresSafeArea()

            WorkshopWebView(model: browser)

            if browser.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .padding(8)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.top, 8)
                    .accessibilityLabel("Loading Cloudflare OS")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if browser.isAwayFromCloudflareOS {
                ExternalPageBar(browser: browser)
            }
        }
        .overlay {
            if let failure = browser.failure {
                LoadFailureView(failure: failure) {
                    browser.retry()
                }
            }
        }
    }
}
private struct ExternalPageBar: View {
    let browser: BrowserModel

    var body: some View {
        HStack(spacing: 12) {
            Button("Back", systemImage: "chevron.left") {
                browser.goBack()
            }
            .disabled(!browser.canGoBack)

            Spacer()

            Text(browser.currentURL?.host ?? "External page")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Spacer()

            Button("Cloudflare OS", systemImage: "hexagon") {
                browser.goHome()
            }
        }
        .labelStyle(.iconOnly)
        .padding(.horizontal, 16)
        .frame(height: 44)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }
}

private struct LoadFailureView: View {
    let failure: BrowserFailure
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Cloudflare OS is unavailable", systemImage: "wifi.exclamationmark")
        } description: {
            Text(failure.message)
        } actions: {
            Button("Try Again", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .background(Color(.systemBackground))
    }
}

#Preview {
    RootView(browser: BrowserModel(configuration: .live))
}
