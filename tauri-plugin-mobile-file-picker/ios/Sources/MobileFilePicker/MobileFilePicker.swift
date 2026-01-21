import Foundation
import UniformTypeIdentifiers
import Tauri
import UIKit

@objc(MobileFilePicker)
public class MobileFilePicker: NSObject {
    var plugin: Plugin
    
    // Store security-scoped URLs for later access
    private var accessedUrls = [String: URL]()

    public init(plugin: Plugin) {
        self.plugin = plugin
        super.init()
    }

    @objc public func pickFile(_ invoke: Invoke) {
        let args = invoke.parseArgs(FilePickerOptions.self)

        DispatchQueue.main.async {
            let documentPicker: UIDocumentPickerViewController

            // Mode semantics:
            // - "import" (asCopy=true): Copy file to app's sandbox, one-time access
            // - "open" (asCopy=false): Access original file, can use bookmarks for long-term access
            let mode = args?.mode ?? "import"
            let asCopy = (mode != "open")

            if #available(iOS 14.0, *) {
                if let types = args?.allowedUTTypes, !types.isEmpty {
                    documentPicker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: asCopy)
                } else {
                    documentPicker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: asCopy)
                }
            } else {
                let pickerMode: UIDocumentPickerMode = asCopy ? .import : .open
                documentPicker = UIDocumentPickerViewController(documentTypes: ["public.data"], in: pickerMode)
            }

            documentPicker.delegate = self
            documentPicker.allowsMultipleSelection = args?.allowMultipleSelection ?? false
            documentPicker.modalPresentationStyle = .formSheet

            // Store options for callback
            objc_setAssociatedObject(documentPicker, &AssociatedKeys.optionsKey, args, .OBJC_ASSOCIATION_RETAIN)

            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                rootViewController.present(documentPicker, animated: true)
            }

            objc_setAssociatedObject(documentPicker, &AssociatedKeys.invokeKey, invoke, .OBJC_ASSOCIATION_RETAIN)
        }
    }

    @objc public func pickDirectory(_ invoke: Invoke) {
        let args = invoke.parseArgs(DirectoryPickerOptions.self)

        DispatchQueue.main.async {
            let documentPicker: UIDocumentPickerViewController

            if #available(iOS 14.0, *) {
                documentPicker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            } else {
                documentPicker = UIDocumentPickerViewController(documentTypes: ["public.folder"], in: .open)
            }

            documentPicker.delegate = self
            documentPicker.modalPresentationStyle = .formSheet

            // Store options for callback - needed for requestLongTermAccess handling
            objc_setAssociatedObject(documentPicker, &AssociatedKeys.directoryOptionsKey, args, .OBJC_ASSOCIATION_RETAIN)

            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                rootViewController.present(documentPicker, animated: true)
            }

            objc_setAssociatedObject(documentPicker, &AssociatedKeys.invokeKey, invoke, .OBJC_ASSOCIATION_RETAIN)
        }
    }

    @objc public func readContent(_ invoke: Invoke) {
        guard let args = invoke.parseArgs(ReadContentOptions.self),
              let uriString = args.uri,
              let url = URL(string: uriString) else {
            invoke.reject("Invalid URI")
            return
        }

        Task.detached(priority: .userInitiated) {
            do {
                let shouldStopAccessing = url.startAccessingSecurityScopedResource()
                defer {
                    if shouldStopAccessing {
                        url.stopAccessingSecurityScopedResource()
                    }
                }

                let data = try Data(contentsOf: url)
                let base64Data = data.base64EncodedString()
                
                var mimeType = "application/octet-stream"
                if #available(iOS 14.0, *) {
                    if let utType = UTType(filenameExtension: url.pathExtension) {
                        mimeType = utType.preferredMIMEType ?? mimeType
                    }
                }

                let response: [String: Any] = [
                    "data": base64Data,
                    "mimeType": mimeType,
                    "size": data.count
                ]
                invoke.resolve(response)
            } catch {
                invoke.reject("Failed to read content: \(error.localizedDescription)")
            }
        }
    }

    @objc public func copyToLocal(_ invoke: Invoke) {
        guard let args = invoke.parseArgs(CopyToLocalOptions.self),
              let uriString = args.uri,
              let sourceUrl = URL(string: uriString) else {
            invoke.reject("Invalid URI")
            return
        }

        Task.detached(priority: .userInitiated) {
            do {
                let shouldStopAccessing = sourceUrl.startAccessingSecurityScopedResource()
                defer {
                    if shouldStopAccessing {
                        sourceUrl.stopAccessingSecurityScopedResource()
                    }
                }

                // Determine destination directory
                let destDir: URL
                if args.destination == "documents" {
                    destDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                } else {
                    destDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                }

                // Create unique subdirectory
                let uniqueDir = destDir.appendingPathComponent(".sendme-\(UUID().uuidString)")
                try FileManager.default.createDirectory(at: uniqueDir, withIntermediateDirectories: true)

                // Determine filename
                let filename = args.filename ?? sourceUrl.lastPathComponent
                let destUrl = uniqueDir.appendingPathComponent(filename)

                // Prevent path traversal
                guard destUrl.path.hasPrefix(uniqueDir.standardized.path) else {
                    invoke.reject("Path traversal detected")
                    return
                }

                // Copy file
                try FileManager.default.copyItem(at: sourceUrl, to: destUrl)

                // Get file attributes
                let attrs = try FileManager.default.attributesOfItem(atPath: destUrl.path)
                let fileSize = attrs[.size] as? Int64 ?? 0

                var mimeType = "application/octet-stream"
                if #available(iOS 14.0, *) {
                    if let utType = UTType(filenameExtension: destUrl.pathExtension) {
                        mimeType = utType.preferredMIMEType ?? mimeType
                    }
                }

                let response: [String: Any] = [
                    "path": destUrl.path,
                    "name": filename,
                    "size": fileSize,
                    "mimeType": mimeType
                ]
                invoke.resolve(response)
            } catch {
                invoke.reject("Failed to copy file: \(error.localizedDescription)")
            }
        }
    }

    @objc public func writeContent(_ invoke: Invoke) {
        guard let args = invoke.parseArgs(WriteContentOptions.self),
              let uriString = args.uri,
              let url = URL(string: uriString),
              let base64Data = args.data,
              let data = Data(base64Encoded: base64Data) else {
            invoke.reject("Invalid arguments")
            return
        }

        Task.detached(priority: .userInitiated) {
            do {
                let shouldStopAccessing = url.startAccessingSecurityScopedResource()
                defer {
                    if shouldStopAccessing {
                        url.stopAccessingSecurityScopedResource()
                    }
                }

                try data.write(to: url)

                let response: [String: Any] = [
                    "success": true,
                    "bytesWritten": data.count
                ]
                invoke.resolve(response)
            } catch {
                invoke.reject("Failed to write content: \(error.localizedDescription)")
            }
        }
    }

    @objc public func releaseSecureAccess(_ invoke: Invoke) {
        guard let args = invoke.parseArgs(ReleaseAccessOptions.self),
              let uris = args.uris else {
            invoke.reject("URIs array is required")
            return
        }

        var releasedCount = 0
        for uriString in uris {
            if let url = accessedUrls[uriString] {
                url.stopAccessingSecurityScopedResource()
                accessedUrls.removeValue(forKey: uriString)
                releasedCount += 1
            }
        }

        let response: [String: Any] = ["releasedCount": releasedCount]
        invoke.resolve(response)
    }

    private func createBookmark(for url: URL) -> String? {
        do {
            let bookmarkData = try url.bookmarkData(
                options: .minimalBookmark,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            return bookmarkData.base64EncodedString()
        } catch {
            return nil
        }
    }

    private func resolveBookmark(_ base64Bookmark: String) -> URL? {
        guard let bookmarkData = Data(base64Encoded: base64Bookmark) else {
            return nil
        }
        
        do {
            var isStale = false
            let url = try URL(
                resolvingBookmarkData: bookmarkData,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
            return url
        } catch {
            return nil
        }
    }
}

extension MobileFilePicker: UIDocumentPickerDelegate {
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let invoke = objc_getAssociatedObject(controller, &AssociatedKeys.invokeKey) as? Invoke else {
            return
        }

        // Check if this is a directory pick
        let directoryOptions = objc_getAssociatedObject(controller, &AssociatedKeys.directoryOptionsKey) as? DirectoryPickerOptions
        if directoryOptions != nil {
            // Handle directory pick - return DirectoryInfo
            guard let url = urls.first else {
                invoke.reject("No directory selected")
                return
            }

            let requestLongTermAccess = directoryOptions?.requestLongTermAccess ?? false
            let shouldStopAccessing = url.startAccessingSecurityScopedResource()

            defer {
                // Don't stop accessing if we want long-term access
                if shouldStopAccessing && !requestLongTermAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }

            do {
                let resourceValues = try url.resourceValues(forKeys: [.nameKey])
                let directoryName = resourceValues.name ?? url.lastPathComponent
                let path = url.path

                // Create bookmark if long-term access requested
                var bookmark: String? = nil
                if requestLongTermAccess {
                    bookmark = self.createBookmark(for: url)
                    if shouldStopAccessing {
                        // Store for later release
                        self.accessedUrls[url.absoluteString] = url
                    }
                }

                let directoryInfo: [String: Any] = [
                    "uri": url.absoluteString,
                    "path": path,
                    "name": directoryName,
                    "bookmark": bookmark as Any
                ]
                invoke.resolve(directoryInfo)
            } catch {
                invoke.reject("Error reading directory: \(error.localizedDescription)")
            }
            return
        }

        // Handle file pick - return array of FileInfo
        let options = objc_getAssociatedObject(controller, &AssociatedKeys.optionsKey) as? FilePickerOptions
        let requestLongTermAccess = options?.requestLongTermAccess ?? false

        let files = urls.compactMap { url -> FileInfo? in
            let shouldStopAccessing = url.startAccessingSecurityScopedResource()

            defer {
                // Don't stop accessing if we want long-term access
                if shouldStopAccessing && !requestLongTermAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }

            do {
                let resourceValues = try url.resourceValues(forKeys: [.fileSizeKey, .nameKey, .contentTypeKey])
                let fileName = resourceValues.name ?? url.lastPathComponent
                let fileSize = resourceValues.fileSize ?? 0

                var mimeType = "application/octet-stream"
                var nativeType: String? = nil

                if #available(iOS 14.0, *) {
                    let utType: UTType? = resourceValues.contentType ?? UTType(filenameExtension: url.pathExtension)
                    mimeType = utType?.preferredMIMEType ?? mimeType
                    nativeType = utType?.identifier
                }

                let path = url.path

                // Create bookmark if long-term access requested
                var bookmark: String? = nil
                if requestLongTermAccess {
                    bookmark = self.createBookmark(for: url)
                    if shouldStopAccessing {
                        // Store for later release
                        self.accessedUrls[url.absoluteString] = url
                    }
                }

                return FileInfo(
                    uri: url.absoluteString,
                    path: path,
                    name: fileName,
                    size: Int64(fileSize),
                    mimeType: mimeType,
                    isVirtual: false,
                    bookmark: bookmark,
                    convertibleToMimeTypes: nil
                )
            } catch {
                return nil
            }
        }

        invoke.resolve(files)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        // Called on iOS 13+, handle cancellation
        documentPickerDidCancel(controller)
    }

    public func documentPickerDidCancel(_ controller: UIDocumentPickerViewController) {
        guard let invoke = objc_getAssociatedObject(controller, &AssociatedKeys.invokeKey) as? Invoke else {
            return
        }

        invoke.reject("User cancelled")
    }
}

// Associated keys for storing invoke and options
private struct AssociatedKeys {
    static var invokeKey: UInt8 = 0
    static var optionsKey: UInt8 = 1
    static var directoryOptionsKey: UInt8 = 2
}

// Models
struct FilePickerOptions: Decodable {
    let allowedUTTypes: [UTType]?
    let allowMultipleSelection: Bool
    let mode: String?
    let requestLongTermAccess: Bool

    enum CodingKeys: String, CodingKey {
        case allowedUTTypes = "allowed_types"
        case allowMultipleSelection = "allow_multiple"
        case mode
        case requestLongTermAccess = "request_long_term_access"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        if let typeStrings = try? container.decode([String].self, forKey: .allowedUTTypes) {
            self.allowedUTTypes = typeStrings.compactMap { UTType($0) }
        } else {
            self.allowedUTTypes = nil
        }

        self.allowMultipleSelection = try container.decodeIfPresent(Bool.self, forKey: .allowMultipleSelection) ?? false
        self.mode = try container.decodeIfPresent(String.self, forKey: .mode)
        self.requestLongTermAccess = try container.decodeIfPresent(Bool.self, forKey: .requestLongTermAccess) ?? false
    }
}

struct DirectoryPickerOptions: Decodable {
    let startDirectory: String?
    let requestLongTermAccess: Bool

    enum CodingKeys: String, CodingKey {
        case startDirectory = "start_directory"
        case requestLongTermAccess = "request_long_term_access"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.startDirectory = try container.decodeIfPresent(String.self, forKey: .startDirectory)
        self.requestLongTermAccess = try container.decodeIfPresent(Bool.self, forKey: .requestLongTermAccess) ?? false
    }
}

struct ReadContentOptions: Decodable {
    let uri: String?
    let convertVirtualAsType: String?

    enum CodingKeys: String, CodingKey {
        case uri
        case convertVirtualAsType = "convert_virtual_as_type"
    }
}

struct CopyToLocalOptions: Decodable {
    let uri: String?
    let destination: String?
    let filename: String?
    let convertVirtualAsType: String?

    enum CodingKeys: String, CodingKey {
        case uri
        case destination
        case filename
        case convertVirtualAsType = "convert_virtual_as_type"
    }
}

struct WriteContentOptions: Decodable {
    let uri: String?
    let data: String?
    let mimeType: String?

    enum CodingKeys: String, CodingKey {
        case uri
        case data
        case mimeType = "mime_type"
    }
}

struct ReleaseAccessOptions: Decodable {
    let uris: [String]?
}

struct FileInfo: Codable {
    let uri: String
    let path: String
    let name: String
    let size: Int64
    let mimeType: String
    let isVirtual: Bool
    let bookmark: String?
    let convertibleToMimeTypes: [String]?
}
