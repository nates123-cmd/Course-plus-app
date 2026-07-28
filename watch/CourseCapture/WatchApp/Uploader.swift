import Foundation
import Combine
import WatchKit

// Ships recordings to the capture-audio endpoint and owns their lifetime.
//
// Two rules drive the design:
//   1. A recording is deleted only after the server confirms receipt. Anything
//      not confirmed stays on disk and is retried on the next launch.
//   2. Uploads use a background URLSession, so a 15 MB file still finishes if
//      the app is suspended when you drop your wrist.
//
// Pending files live in Application Support/pending. The queue is the directory
// listing itself rather than a separate index, so there is no way for the two
// to disagree.
@MainActor
final class Uploader: NSObject, ObservableObject {
    @Published private(set) var pending: Int = 0
    @Published private(set) var status: String = ""

    static let shared = Uploader()

    private let sessionID = "app.courseplus.capture.upload"
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.background(withIdentifier: sessionID)
        c.isDiscretionary = false          // the user just spoke; send it now
        c.sessionSendsLaunchEvents = true
        c.waitsForConnectivity = true
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    // Set by the app delegate when watchOS wakes us for background session events.
    var backgroundCompletion: (() -> Void)?

    private var pendingDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("pending", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func pendingFiles() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: pendingDir, includingPropertiesForKeys: nil)) ?? []
    }

    func refreshCount() { pending = pendingFiles().count }

    /// Take ownership of a finished recording and start shipping it.
    func enqueue(_ tempURL: URL) {
        let dest = pendingDir.appendingPathComponent(tempURL.lastPathComponent)
        do {
            try FileManager.default.moveItem(at: tempURL, to: dest)
        } catch {
            status = "Could not save"
            return
        }
        refreshCount()
        send(dest)
    }

    /// Retry anything left over from a previous run. Safe to call repeatedly:
    /// a file already in flight simply gets another task, and the first 2xx
    /// removes it.
    func retryPending() {
        let files = pendingFiles()
        refreshCount()
        guard !files.isEmpty else { return }
        status = "Retrying \(files.count)"
        files.forEach(send)
    }

    private func send(_ file: URL) {
        var req = URLRequest(url: Config.audioEndpoint)
        req.httpMethod = "POST"
        req.setValue(Config.captureKey, forHTTPHeaderField: "x-capture-key")
        req.setValue("audio/m4a", forHTTPHeaderField: "content-type")
        // Carried through so the delegate knows which file a task belongs to.
        req.setValue(file.lastPathComponent, forHTTPHeaderField: "x-capture-file")

        let task = session.uploadTask(with: req, fromFile: file)
        task.taskDescription = file.lastPathComponent
        status = "Sending"
        task.resume()
    }

    private func finished(_ name: String, ok: Bool, message: String) {
        if ok {
            try? FileManager.default.removeItem(at: pendingDir.appendingPathComponent(name))
        }
        refreshCount()
        status = message
    }
}

extension Uploader: URLSessionDataDelegate {
    nonisolated func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        // The endpoint answers with a single short line meant to be read at a
        // glance. Show it verbatim rather than inventing our own wording.
        let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let code = (dataTask.response as? HTTPURLResponse)?.statusCode ?? 0
        let name = dataTask.taskDescription ?? ""
        Task { @MainActor in
            self.finished(name, ok: (200..<300).contains(code), message: body.isEmpty ? "HTTP \(code)" : body)
        }
    }

    nonisolated func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let name = task.taskDescription ?? ""
        let code = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        Task { @MainActor in
            if let error {
                // Kept on disk. Retried next launch.
                self.finished(name, ok: false, message: "Not sent: \(error.localizedDescription)")
            } else if !(200..<300).contains(code) {
                self.finished(name, ok: false, message: "Not sent: HTTP \(code)")
            }
        }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession s: URLSession) {
        Task { @MainActor in
            self.backgroundCompletion?()
            self.backgroundCompletion = nil
        }
    }
}
