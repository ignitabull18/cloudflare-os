import Foundation
import Observation
import WebKit

struct BrowserFailure: Equatable {
    let message: String
}
@MainActor
@Observable
final class BrowserModel {
    private enum StorageKey {
        static let lastTrustedURL = "CloudflareOS.lastTrustedURL"
    }

    let configuration: AppConfiguration
    private(set) var currentURL: URL?
    private(set) var isLoading = true
    private(set) var canGoBack = false
    private(set) var failure: BrowserFailure?

    @ObservationIgnored weak var webView: WKWebView?

    init(configuration: AppConfiguration) {
        self.configuration = configuration
    }

    var initialURL: URL {
        guard let stored = UserDefaults.standard.string(forKey: StorageKey.lastTrustedURL),
              let url = URL(string: stored),
              let trustedURL = configuration.trustedURL(from: url)
        else {
            return configuration.baseURL
        }
        return trustedURL
    }

    var isAwayFromCloudflareOS: Bool {
        guard let currentURL else { return false }
        return configuration.trustedURL(from: currentURL) == nil
    }

    func attach(_ webView: WKWebView) {
        self.webView = webView
        updateNavigationState(from: webView)
    }

    func navigationStarted(in webView: WKWebView) {
        failure = nil
        isLoading = true
        updateNavigationState(from: webView)
    }

    func navigationFinished(in webView: WKWebView) {
        failure = nil
        isLoading = false
        updateNavigationState(from: webView)

        if let currentURL, let trustedURL = configuration.trustedURL(from: currentURL) {
            UserDefaults.standard.set(trustedURL.absoluteString, forKey: StorageKey.lastTrustedURL)
        }
    }

    func navigationFailed(_ error: Error, in webView: WKWebView) {
        isLoading = false
        updateNavigationState(from: webView)

        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        failure = BrowserFailure(message: error.localizedDescription)
    }

    func retry() {
        failure = nil
        if webView?.url == nil {
            load(initialURL)
        } else {
            webView?.reload()
        }
    }

    func goBack() {
        webView?.goBack()
    }

    func goHome() {
        load(configuration.baseURL)
    }

    func openDeepLink(_ url: URL) {
        guard let destination = configuration.deepLinkDestination(for: url) else { return }
        load(destination)
    }

    private func load(_ url: URL) {
        webView?.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
    }

    private func updateNavigationState(from webView: WKWebView) {
        currentURL = webView.url
        canGoBack = webView.canGoBack
    }
}
