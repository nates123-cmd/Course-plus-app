import AVFoundation
import Foundation
import Combine

// Mic recording for the watch.
//
// Deliberately single-file rather than segmented. watchOS ends a recording when
// an audio interruption arrives (an incoming call, or Siri), and the honest
// thing for a first version is to surface that loudly rather than paper over it
// with resume logic that may or may not work. If interruptions turn out to be
// common in real meetings, segmenting is the follow-up.
//
// The recording file is never deleted here. Uploader owns its lifetime and only
// removes it once the server has confirmed receipt.
@MainActor
final class Recorder: NSObject, ObservableObject {
    enum State: Equatable { case idle, recording, finishing }

    @Published private(set) var state: State = .idle
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var interrupted = false
    @Published var error: String?

    private var recorder: AVAudioRecorder?
    private var ticker: Timer?
    private var currentURL: URL?

    var onFinished: ((URL) -> Void)?

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification, object: nil)
    }

    func toggle() {
        switch state {
        case .idle: start()
        case .recording: stop()
        case .finishing: break
        }
    }

    private func start() {
        error = nil
        interrupted = false

        AVAudioApplication.requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                guard let self else { return }
                guard granted else { self.error = "Mic denied"; return }
                self.beginSession()
            }
        }
    }

    private func beginSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            // .record rather than .playAndRecord — nothing is played back, and a
            // record-only session is less likely to be interrupted.
            try session.setCategory(.record, mode: .default)
            try session.setActive(true, options: [])
        } catch {
            self.error = "Audio session failed"
            return
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("capture-\(UUID().uuidString).m4a")

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: Config.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: Config.bitRate,
        ]

        do {
            let r = try AVAudioRecorder(url: url, settings: settings)
            r.delegate = self
            guard r.record() else { self.error = "Could not start"; return }
            recorder = r
            currentURL = url
            state = .recording
            elapsed = 0
            startTicking()
        } catch {
            self.error = "Recorder failed"
        }
    }

    private func stop() {
        state = .finishing
        recorder?.stop() // delegate callback finalizes the file
    }

    private func startTicking() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let r = self.recorder, r.isRecording else { return }
                self.elapsed = r.currentTime
            }
        }
    }

    private func finish() {
        ticker?.invalidate(); ticker = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        let url = currentURL
        recorder = nil
        currentURL = nil
        state = .idle
        if let url { onFinished?(url) }
    }

    @objc private nonisolated func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        Task { @MainActor in
            // .began means the recording has already stopped. Flag it so the UI
            // can say so plainly — whatever was captured up to this point is
            // still finalized and uploaded rather than discarded.
            if type == .began, self.state == .recording {
                self.interrupted = true
                self.stop()
            }
        }
    }
}

extension Recorder: AVAudioRecorderDelegate {
    nonisolated func audioRecorderDidFinishRecording(_ r: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            if !flag { self.error = "Recording failed" }
            self.finish()
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ r: AVAudioRecorder, error: Error?) {
        Task { @MainActor in
            self.error = "Encode error"
            self.finish()
        }
    }
}
