import SwiftUI
import WatchKit

@main
struct CourseCaptureApp: App {
    @WKApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

final class AppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        // Anything that did not make it out last time goes now.
        Task { @MainActor in Uploader.shared.retryPending() }
    }

    // watchOS wakes us when a background upload finishes. Hand the completion
    // handler to the uploader so the system knows when we are done.
    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            if let urlTask = task as? WKURLSessionRefreshBackgroundTask {
                Task { @MainActor in
                    Uploader.shared.backgroundCompletion = { urlTask.setTaskCompletedWithSnapshot(false) }
                    Uploader.shared.retryPending()
                }
            } else {
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }
}
