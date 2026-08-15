import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Platform, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, type WebViewNavigation } from 'react-native-webview'

const OPERATIONS_URL = 'https://os.ignitabull.org/operations'

export default function CloudflareOsScreen() {
  const webView = useRef<WebView>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [failed, setFailed] = useState(false)

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack)
  }, [])

  const handleAndroidBack = useCallback(() => {
    if (!canGoBack) return false
    webView.current?.goBack()
    return true
  }, [canGoBack])

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleAndroidBack)
    return () => subscription.remove()
  }, [handleAndroidBack])

  if (failed) {
    return (
      <SafeAreaView style={styles.fallback}>
        <Text style={styles.title}>Cloudflare OS is unreachable</Text>
        <Text style={styles.message}>Check your connection, then reopen the app. Your systems continue running in Cloudflare.</Text>
      </SafeAreaView>
    )
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webView}
        source={{ uri: OPERATIONS_URL }}
        originWhitelist={['https://*', 'cloudflareos://*']}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        allowsLinkPreview={false}
        pullToRefreshEnabled
        setSupportMultipleWindows={false}
        onNavigationStateChange={onNavigationStateChange}
        onError={() => setFailed(true)}
        onHttpError={(event) => { if (event.nativeEvent.statusCode >= 500) setFailed(true) }}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color="#ff4801" />
          </View>
        )}
        style={styles.webview}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fcfcfb' },
  webview: { flex: 1, backgroundColor: '#fcfcfb' },
  loading: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fcfcfb',
  },
  fallback: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, backgroundColor: '#fcfcfb' },
  title: { color: '#100f0d', fontSize: 24, lineHeight: 30, fontWeight: '600' },
  message: { color: '#716f6c', fontSize: 16, lineHeight: 24, marginTop: 12 },
})
