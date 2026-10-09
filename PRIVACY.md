# Privacy Policy — Sound Enhancer 98

**Last updated: October 9, 2026**

This policy explains how the Sound Enhancer 98 Chrome extension handles information. Its purpose is to let you adjust the volume, tone, and stereo balance of individual browser tabs and remember audio settings for each website.

**Audio is processed locally on your device. The extension does not record or upload audio, and it does not send your tab information or saved profiles to the developer or external services.** It does access information locally to provide its features, as described below.

## 1. Information the extension handles

| Information | Why it is used | How it is handled |
| --- | --- | --- |
| Audio from a tab you explicitly connect | Apply volume, bass, treble, stereo balance, mute, and limiter settings, and display an output meter. | Processed temporarily in memory and played back through your browser. No audio recordings or audio files are created. |
| Open-tab information, including titles, URLs, tab and window identifiers, and audio or mute status | Display audio sources, identify each website, manage independent mixers, and detect when a connected tab closes or changes websites. | Used locally during operation. Full website URLs and tab titles are not saved in website profiles or uploaded. |
| Website audio profiles | Restore your preferred settings when you connect a tab on that website again. | Stored locally in Chrome. A profile contains a website hostname, including its port if present, and volume, bass, treble, balance, mute, and limiter settings. |
| The “Remember settings for each website” preference | Control whether website profiles are saved automatically. | Stored locally in Chrome. This preference is enabled by default. |

The extension does not access Chrome's stored browsing-history database or maintain a log of page visits. However, it does read current tab titles and website addresses for its mixer and retains the website hostnames associated with saved profiles.

The extension captures tab audio only after you choose **Connect this tab**. It does not request microphone, camera, or video capture. Audio processing adjusts the signal; it does not perform speech recognition, transcription, or analysis of what is being said.

## 2. How information is used and shared

Information handled by the extension is used only to provide the audio controls and website profiles described in this policy.

The extension:

- Does not transmit captured audio, tab information, or website profiles off your device.
- Does not sell, rent, or share that information with advertisers, data brokers, or other third parties.
- Does not include analytics, advertising, tracking, or remote crash-reporting services.
- Does not use information for advertising, unrelated profiling, creditworthiness, or lending decisions.
- Does not provide the developer with remote access to your audio or locally stored profiles.

No account, login, or payment information is required to use the extension. It does not request passwords, authentication cookies, health information, or location data, and it does not inspect website text, images, or forms.

## 3. Storage, retention, and your controls

Website profiles and the Remember settings preference are saved using `chrome.storage.local` in your Chrome browser profile. The extension does not use `chrome.storage.sync` or its own cloud storage.

**Audio:** Audio is handled in memory for live processing and is not retained as a recording. Capture ends when you disconnect the tab, close the source tab, navigate it to a different website hostname, or the capture or extension session ends. Closing the mixer popup or its separate window does **not** disconnect audio; choose **Disconnect this tab** to stop processing.

**Tab information:** Current tab information is used during operation and is not written to the saved profile storage as a browsing-history log.

**Saved settings:** Profiles and the Remember settings preference persist across browser restarts and do not automatically expire. You can:

- Open **Websites** and choose **Forget** to delete a saved website profile. A profile can be saved again if you later adjust or reconnect that website with Remember settings enabled.
- Turn off **Remember settings for each website** to stop future automatic profile saves. Turning this off does not delete profiles already saved.
- Remove the extension to clear its local extension storage. Chrome documents this behavior in its [Storage API reference](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas).

## 4. Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Obtain temporary, user-initiated access needed to request audio capture from the selected tab. |
| `tabs` | Read current tab titles and URLs for the source selector, website profiles, and connection management. |
| `tabCapture` | Obtain the audio stream of a tab you explicitly connect for local processing and playback. |
| `offscreen` | Run the audio engine in an offscreen extension document so processing can continue after the mixer closes. |
| `storage` | Save website profiles and the Remember settings preference locally. |

## 5. Chrome Web Store Limited Use

Sound Enhancer 98's handling of information received through Google and Chrome APIs complies with the [Chrome Web Store User Data Policy, including its Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use). Information is used only for the extension's disclosed audio-control features, with no advertising use, unrelated use, sale, or transfer to third parties.

## 6. Other services and support

Websites you visit, Google Chrome, the Chrome Web Store, and GitHub operate under their own privacy policies. This policy covers the extension's behavior; it does not cover those services' independent data practices.

If you voluntarily submit a support message through GitHub or the Chrome Web Store, that message is separate from the data processed locally by the extension. The maintainer may use the information you provide to respond to your request, and the platform's privacy practices also apply.

## 7. Changes to this policy

This policy may be updated to reflect changes to the extension. The date above identifies the latest revision. Changes to data handling will be disclosed through the updated policy and, where applicable, the extension interface and Chrome Web Store listing before the new practices take effect.

## 8. Contact

For privacy questions or concerns, contact the maintainer through the [Sound Enhancer project repository](https://github.com/ShadowsLunarfox/Sound-Enhancer).
