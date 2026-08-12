import SwiftUI
import UIKit
import WebKit

struct WorkshopWebView: UIViewRepresentable {
    let model: BrowserModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = "CloudflareOS-iOS/1.0"

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        let refreshControl = UIRefreshControl()
        refreshControl.addTarget(
            context.coordinator,
            action: #selector(Coordinator.refresh(_:)),
            for: .valueChanged
        )
        webView.scrollView.refreshControl = refreshControl

        model.attach(webView)
        webView.load(URLRequest(
            url: model.initialURL,
            cachePolicy: .useProtocolCachePolicy,
            timeoutInterval: 30
        ))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let model: BrowserModel
        private weak var popupContainer: UIView?
        private weak var popupWebView: WKWebView?

        init(model: BrowserModel) {
            self.model = model
        }

        @objc func refresh(_ sender: UIRefreshControl) {
            model.webView?.reload()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
            guard webView === model.webView else { return }
            model.navigationStarted(in: webView)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            webView.scrollView.refreshControl?.endRefreshing()
            guard webView === model.webView else { return }
            model.navigationFinished(in: webView)
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation?,
            withError error: Error
        ) {
            webView.scrollView.refreshControl?.endRefreshing()
            guard webView === model.webView else { return }
            model.navigationFailed(error, in: webView)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation?,
            withError error: Error
        ) {
            webView.scrollView.refreshControl?.endRefreshing()
            guard webView === model.webView else { return }
            model.navigationFailed(error, in: webView)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if let scheme = url.scheme?.lowercased(), ["tel", "mailto", "sms"].contains(scheme) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil else { return nil }

            closePopup()

            guard let primaryWebView = model.webView else { return nil }

            let container = UIView(frame: primaryWebView.bounds)
            container.backgroundColor = .systemBackground
            container.autoresizingMask = [.flexibleWidth, .flexibleHeight]

            let toolbar = UIToolbar()
            toolbar.translatesAutoresizingMaskIntoConstraints = false
            let closeButton = UIBarButtonItem(
                title: "Close",
                style: .done,
                target: self,
                action: #selector(closePopup)
            )
            toolbar.items = [
                UIBarButtonItem(
                    barButtonSystemItem: .flexibleSpace,
                    target: nil,
                    action: nil
                ),
                closeButton,
            ]

            let popup = WKWebView(frame: .zero, configuration: configuration)
            popup.translatesAutoresizingMaskIntoConstraints = false
            popup.navigationDelegate = self
            popup.uiDelegate = self
            popup.allowsBackForwardNavigationGestures = true

            container.addSubview(toolbar)
            container.addSubview(popup)
            primaryWebView.addSubview(container)

            NSLayoutConstraint.activate([
                toolbar.topAnchor.constraint(equalTo: container.topAnchor),
                toolbar.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                toolbar.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                popup.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
                popup.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                popup.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                popup.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            ])

            popupContainer = container
            popupWebView = popup
            return popup
        }

        func webViewDidClose(_ webView: WKWebView) {
            if webView === popupWebView {
                closePopup()
            }
        }

        @objc private func closePopup() {
            popupWebView?.navigationDelegate = nil
            popupWebView?.uiDelegate = nil
            popupContainer?.removeFromSuperview()
            popupWebView = nil
            popupContainer = nil
        }
    }
}
