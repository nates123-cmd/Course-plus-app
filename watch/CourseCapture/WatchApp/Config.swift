import Foundation

// Endpoint + shared secret. The secret lives in Secrets.swift, which is
// gitignored — copy Secrets.example.swift to Secrets.swift and paste the
// CAPTURE_KEY value in. Nothing here should ever hold the key itself.
enum Config {
    static let audioEndpoint = URL(string: "https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture-audio")!
    static let captureKey = Secrets.captureKey

    // Recording format. Speech, not music: mono, modest bitrate. An hour lands
    // around 15 MB, which the endpoint accepts comfortably.
    static let sampleRate: Double = 22050
    static let bitRate: Int = 32000
}
