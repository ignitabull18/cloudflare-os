import SwiftUI

@main
struct CloudflareOSApp: App {
    @State private var browser = BrowserModel(configuration: .live)

    var body: some Scene {
        WindowGroup {
            RootView(browser: browser)
                .onOpenURL { url in
                    browser.openDeepLink(url)
                }
        }
    }
}
