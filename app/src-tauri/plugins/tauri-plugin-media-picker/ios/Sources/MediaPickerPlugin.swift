import PhotosUI
import Tauri
import UIKit
import WebKit

class MediaPickerPlugin: Plugin {
    // nonisolated(unsafe) is safe here: currentInvoke is set on the
    // Tauri invoke thread and read only inside the @MainActor delegate
    // callback, with no concurrent mutation possible.
    nonisolated(unsafe) var currentInvoke: Invoke?
    var webView: WKWebView?

    @objc override public func load(webview: WKWebView) {
        super.load(webview: webview)
        self.webView = webview
    }

    @objc public func pickMedia(_ invoke: Invoke) {
        currentInvoke = invoke

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

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

extension MediaPickerPlugin: PHPickerViewControllerDelegate {
    public func picker(
        _ picker: PHPickerViewController,
        didFinishPicking results: [PHPickerResult]
    ) {
        picker.dismiss(animated: true)

        guard !results.isEmpty else {
            currentInvoke?.resolve([JSObject]())
            currentInvoke = nil
            return
        }

        let invoke = currentInvoke
        currentInvoke = nil

        var mediaFiles: [JSObject] = []
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

                    var obj = JSObject()
                    obj["uri"] = destURL.absoluteString
                    obj["name"] = url.lastPathComponent
                    obj["size"] = size
                    obj["mimeType"] = mimeType(for: typeIdentifier)

                    lock.lock()
                    mediaFiles.append(obj)
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

    private func mimeType(for typeIdentifier: String) -> String {
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
    return MediaPickerPlugin()
}
