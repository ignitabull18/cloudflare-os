import Foundation

struct AppConfiguration: Sendable {
    let baseURL: URL

    static let live: AppConfiguration = {
        let configuredURL = Bundle.main.object(forInfoDictionaryKey: "CloudflareOSBaseURL") as? String
        let fallbackURL = URL(string: "https://os.ignitabull.org")!
        return AppConfiguration(baseURL: configuredURL.flatMap(URL.init(string:)) ?? fallbackURL)
    }()

    func trustedURL(from candidate: URL) -> URL? {
        guard candidate.scheme == "https",
              candidate.host?.lowercased() == baseURL.host?.lowercased()
        else {
            return nil
        }
        return candidate
    }

    func deepLinkDestination(for url: URL) -> URL? {
        if let trustedURL = trustedURL(from: url) {
            return trustedURL
        }

        guard url.scheme == "cloudflareos", url.host == "open",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let path = components.queryItems?.first(where: { $0.name == "path" })?.value,
              path.hasPrefix("/")
        else {
            return nil
        }

        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }
}
