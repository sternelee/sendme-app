import Foundation
import UniformTypeIdentifiers
import Tauri
import UIKit

@objc(MobileFilePicker)
public class MobileFilePicker: NSObject {
    var plugin: Plugin

    public init(plugin: Plugin) {
        self.plugin = plugin
        super.init()
    }

    @objc public func pickFile(_ invoke: Invoke) {
        let args = invoke.parseArgs(FilePickerOptions.self)

        DispatchQueue.main.async {
            let documentPicker: UIDocumentPickerViewController

            if #available(iOS 14.0, *) {
                if let types = args?.allowedUTTypes, !types.isEmpty {
                    documentPicker = UIDocumentPickerViewController(forOpeningContentTypes: types)
                } else {
                    documentPicker = UIDocumentPickerViewController(forOpeningContentTypes: [.item])
                }
            } else {
                documentPicker = UIDocumentPickerViewController(documentTypes: ["public.data"], in: .import)
            }

            documentPicker.delegate = self
            documentPicker.allowsMultipleSelection = args?.allowMultipleSelection ?? false
            documentPicker.modalPresentationStyle = .formSheet

            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                rootViewController.present(documentPicker, animated: true)
            }

            // Store invoke for later callback
            objc_setAssociatedObject(documentPicker, &AssociatedKeys.invokeKey, invoke, .OBJC_ASSOCIATION_RETAIN)
        }
    }

    @objc public func pickDirectory(_ invoke: Invoke) {
        DispatchQueue.main.async {
            let documentPicker: UIDocumentPickerViewController

            if #available(iOS 14.0, *) {
                documentPicker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            } else {
                documentPicker = UIDocumentPickerViewController(documentTypes: ["public.folder"], in: .open)
            }

            documentPicker.delegate = self
            documentPicker.modalPresentationStyle = .formSheet

            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                rootViewController.present(documentPicker, animated: true)
            }

            // Store invoke for later callback
            objc_setAssociatedObject(documentPicker, &AssociatedKeys.invokeKey, invoke, .OBJC_ASSOCIATION_RETAIN)
        }
    }
}

extension MobileFilePicker: UIDocumentPickerDelegate {
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let invoke = objc_getAssociatedObject(controller, &AssociatedKeys.invokeKey) as? Invoke else {
            return
        }

        let files = urls.compactMap { url -> FileInfo? in
            guard url.startAccessingSecurityScopedResource() else {
                return nil
            }

            defer {
                url.stopAccessingSecurityScopedResource()
            }

            do {
                let resourceValues = try url.resourceValues(forKeys: [.fileSizeKey, .nameKey, .contentTypeKey])
                let fileName = resourceValues.name ?? url.lastPathComponent
                let fileSize = resourceValues.fileSize ?? 0
                let mimeType = resourceValues.contentType?.identifier ?? "application/octet-stream"

                // Get file path
                let path = url.path

                return FileInfo(
                    uri: url.absoluteString,
                    path: path,
                    name: fileName,
                    size: Int64(fileSize),
                    mimeType: mimeType
                )
            } catch {
                return nil
            }
        }

        invoke.resolve(files)
    }

    public func documentPickerDidCancel(_ controller: UIDocumentPickerViewController) {
        guard let invoke = objc_getAssociatedObject(controller, &AssociatedKeys.invokeKey) as? Invoke else {
            return
        }

        invoke.reject("User cancelled")
    }
}

// Associated keys for storing invoke
private struct AssociatedKeys {
    static var invokeKey: UInt8 = 0
}

// Models
struct FilePickerOptions: Decodable {
    let allowedUTTypes: [UTType]?
    let allowMultipleSelection: Bool

    enum CodingKeys: String, CodingKey {
        case allowedUTTypes = "allowed_types"
        case allowMultipleSelection = "allow_multiple"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Decode UTTypes from strings
        if let typeStrings = try? container.decode([String].self, forKey: .allowedUTTypes) {
            self.allowedUTTypes = typeStrings.compactMap { UTType($0) }
        } else {
            self.allowedUTTypes = nil
        }

        self.allowMultipleSelection = try container.decodeIfPresent(Bool.self, forKey: .allowMultipleSelection) ?? false
    }
}

struct FileInfo: Codable {
    let uri: String
    let path: String
    let name: String
    let size: Int64
    let mimeType: String
}
