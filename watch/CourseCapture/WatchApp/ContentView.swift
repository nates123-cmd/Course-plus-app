import SwiftUI

struct ContentView: View {
    @StateObject private var recorder = Recorder()
    @StateObject private var uploader = Uploader.shared

    var body: some View {
        VStack(spacing: 10) {
            Text(recorder.state == .recording ? clock : "Course+")
                .font(.system(size: recorder.state == .recording ? 34 : 17,
                              weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(recorder.state == .recording ? .primary : .secondary)

            Button(action: recorder.toggle) {
                ZStack {
                    Circle()
                        .fill(recorder.state == .recording ? Color.red : Color.accentColor)
                    Image(systemName: recorder.state == .recording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(.black)
                }
                .frame(width: 84, height: 84)
            }
            .buttonStyle(.plain)
            .disabled(recorder.state == .finishing)

            Text(footer)
                .font(.system(size: 12))
                .foregroundStyle(footerColor)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .padding(.horizontal, 6)
        .onAppear {
            recorder.onFinished = { url in uploader.enqueue(url) }
            uploader.refreshCount()
        }
    }

    private var clock: String {
        let t = Int(recorder.elapsed)
        return String(format: "%d:%02d", t / 60, t % 60)
    }

    // One line, glanceable. Problems win over progress: an interrupted
    // recording or a stuck upload matters more than a cheerful confirmation.
    private var footer: String {
        if let e = recorder.error { return e }
        if recorder.interrupted { return "Interrupted — sent what we had" }
        if uploader.pending > 0 { return "\(uploader.pending) waiting to send" }
        if !uploader.status.isEmpty { return uploader.status }
        return recorder.state == .recording ? "Tap to stop" : "Tap to record"
    }

    private var footerColor: Color {
        if recorder.error != nil || recorder.interrupted { return .orange }
        if uploader.pending > 0 { return .yellow }
        return .secondary
    }
}
