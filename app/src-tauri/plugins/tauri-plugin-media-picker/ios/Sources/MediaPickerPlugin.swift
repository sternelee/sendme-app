import PhotosUI
import Tauri
import UIKit
import WebKit

struct MediaFileResult: Codable {
    let uri: String
    let name: String
    let size: Int
    let mimeType: String
}

@available(iOS 14.0, *)
class MediaPickerPlugin: Plugin {
    // All access to currentInvoke is confined to the main thread:
    // - set inside DispatchQueue.main.async in pickMedia
    // - read/cleared in picker(_:didFinishPicking:) which runs on main thread
    var currentInvoke: Invoke?
    var webView: WKWebView?

    @objc override public func load(webview: WKWebView) {
        super.load(webview: webview)
        self.webView = webview
    }

    @objc public func pickMedia(_ invoke: Invoke) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            // currentInvoke is set here on the main thread — no data race
            self.currentInvoke = invoke

            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.filter = PHPickerFilter.any(of: [.images, .videos])
            config.selectionLimit = 0 // 0 = unlimited

            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self

            guard let presenter = self.webView?.window?.rootViewController else {
                self.currentInvoke?.reject("Unable to find presenter view controller")
                self.currentInvoke = nil
                return
            }

            presenter.present(picker, animated: true)
        }
    }
}

@available(iOS 14.0, *)
extension MediaPickerPlugin: PHPickerViewControllerDelegate {
    // Called on the main thread by PHPickerViewController
    public func picker(
        _ picker: PHPickerViewController,
        didFinishPicking results: [PHPickerResult]
    ) {
        picker.dismiss(animated: true)

        guard !results.isEmpty else {
            currentInvoke?.resolve([] as [MediaFileResult])
            currentInvoke = nil
            return
        }

        let invoke = currentInvoke
        currentInvoke = nil

        var mediaFiles: [MediaFileResult] = []
        let lock = NSLock()
        let group = DispatchGroup()

        for result in results {
            let itemProvider = result.itemProvider
            guard let typeIdentifier = itemProvider.registeredTypeIdentifiers.first else {
                continue
            }

            group.enter()
            itemProvider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                defer { group.leave() }

                guard let url = url, error == nil else { return }

                // The url is only valid during this callback — copy it to tmp
                let tmpDir = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString)
                let destURL = tmpDir.appendingPathComponent(url.lastPathComponent)

                do {
                    try FileManager.default.createDirectory(
                        at: tmpDir, withIntermediateDirectories: true)
                    try FileManager.default.copyItem(at: url, to: destURL)

                    let attrs = try FileManager.default.attributesOfItem(atPath: destURL.path)
                    let size = attrs[.size] as? Int ?? 0

                    let file = MediaFileResult(
                        uri: destURL.absoluteString,
                        name: url.lastPathComponent,
                        size: size,
                        mimeType: MediaPickerPlugin.mimeType(for: typeIdentifier)
                    )

                    lock.lock()
                    mediaFiles.append(file)
                    lock.unlock()
                } catch {
                    // Skip files that fail to copy; log to console
                    print("[MediaPickerPlugin] Failed to copy \(url.lastPathComponent): \(error)")
                }
            }
        }

        group.notify(queue: .main) {
            invoke?.resolve(mediaFiles)
        }
    }

    private static func mimeType(for typeIdentifier: String) -> String {
        switch typeIdentifier {
        case "public.jpeg":                  return "image/jpeg"
        case "public.png":                   return "image/png"
        case "public.heic", "public.heif":   return "image/heic"
        case "public.tiff":                  return "image/tiff"
        case "public.gif":                   return "image/gif"
        case "com.apple.quicktime-movie":    return "video/quicktime"
        case "public.mpeg-4":               return "video/mp4"
        case "public.movie":               return "video/quicktime"
        default:
            if typeIdentifier.hasPrefix("public.") && typeIdentifier.contains("video") {
                return "video/quicktime"
            }
            if typeIdentifier.hasPrefix("public.") && typeIdentifier.contains("image") {
                return "image/jpeg"
            }
            return "application/octet-stream"
        }
    }
}

@_cdecl("init_plugin_media_picker")
func initPlugin() -> Plugin {
    if #available(iOS 14.0, *) {
        return MediaPickerPlugin()
    } else {
        fatalError("MediaPickerPlugin requires iOS 14.0+")
    }
}
