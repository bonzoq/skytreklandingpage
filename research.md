# TrackSocial (Skytrek) - Deep Research Report

## 1. Project Overview

**TrackSocial** is an iOS app branded as **"Skytrek"** -- a flight logging and social sharing platform for pilots. It allows users to import flight tracks from Electronic Flight Bag (EFB) software (primarily SkyDemon), view them on maps, attach metadata (aircraft details, photos, descriptions), organize flights into trips, and share trip maps as polished images.

- **Created by:** Marcin Kmiec
- **Created on:** November 1, 2024
- **Platform:** iOS (SwiftUI + UIKit hybrid)
- **Backend:** Firebase (Firestore, Storage, Auth, AppCheck)
- **Bundle ID:** `bonzoq.TrackSocial1`
- **Custom URL scheme:** `com.tracksocial`
- **App Group:** `group.tracksocial1`

---

## 2. Architecture & Project Structure

### 2.1 Xcode Targets

| Target | Purpose |
|---|---|
| `TrackSocial` | Main app target (primary, active development) |
| `TrackSocialApp` | Duplicate/legacy app target (older version, lacks Trip support) |
| `TrackSocialShare` | Share Extension for receiving KML files from other apps |
| `ShareExtension` | Empty share extension (unused) |
| `TrackSocialTests` | Unit tests (scaffold only, no real tests) |
| `TrackSocialUITests` | UI tests (scaffold only, no real tests) |

### 2.2 Folder Structure

```
TrackSocial/
├── Data Models/       # Core data types (FlightData, Trip, Aircraft)
├── Extensions/        # UIImage resizing extension
├── Managers/          # Business logic (Auth, FlightData, Storage, Trip, ImageCache, ProfileImageLoader)
├── Parsers/           # GPX and KML file parsers
├── Utils/             # Utilities (MapSnapshotter, TaskExtensions, Visibility, Date/Array helpers)
├── Views/
│   ├── Tab Views/     # Main tab screens (FeedView, FlightListView, ImportFlightView, ProfileView)
│   ├── FlightDataViews/
│   │   ├── Components/  # Reusable text field components
│   │   ├── Subviews/    # Flight detail subviews (map, photos, info, visibility)
│   │   ├── EditFlightData.swift  # Main flight editing form
│   │   └── LogFlightView.swift   # Read-only flight detail view
│   └── TripViews/     # Trip CRUD views + map editor/export
├── AppGroup.swift     # Shared container for app + share extension
├── ContentView.swift  # Root view + TabRouter
├── TrackSocialApp.swift  # App entry point + Firebase init
├── Assets.xcassets/   # Images, app icon, custom pin assets
├── GoogleService-Info.plist
├── Info.plist
└── TrackSocial.entitlements
```

### 2.3 Design Pattern

- **MVVM-ish** with `@StateObject` managers as view models
- Four `ObservableObject` managers injected as `@EnvironmentObject` through the view hierarchy:
  - `AuthManager` - Authentication state
  - `FlightDataManager` - Flight CRUD + photo uploads
  - `TripManager` - Trip CRUD
  - `TabRouter` - Tab selection state
- No formal dependency injection; managers are created in `TrackSocialApp` and passed down via `.environmentObject()`

---

## 3. Firebase Backend

### 3.1 Services Used

| Service | Purpose |
|---|---|
| **Firestore** | Primary database for flights, trips, and user profiles |
| **Firebase Storage** | Photo storage (flight photos, profile images, cover photos) |
| **Firebase Auth** | Email/password authentication |
| **Firebase AppCheck** | App attestation (uses debug provider in dev, AppAttest in production) |

### 3.2 Firestore Collections

- **`flights`** - Flight documents keyed by UUID, filtered by `userId`
- **`trips`** - Trip documents keyed by UUID, filtered by `userId`, ordered by `updatedAt`
- **`users`** - User profile data (profileImageUrl, coverImageUrl)

### 3.3 Storage Paths

- `flight_photos/{flightId}/{timestamp}_{random}.jpg` - Flight photos
- `profile_images/{uuid}.jpg` - Profile pictures
- `cover_photo/{uuid}.jpg` - Cover photos
- Storage bucket: `gs://tracksocial-151f1.firebasestorage.app`

### 3.4 Offline Support

Firestore offline persistence is explicitly enabled with unlimited cache size. The app follows an **optimistic update pattern**: local state is updated immediately, then Firebase sync happens in the background. This applies to:
- Adding flights
- Updating flight metadata
- Creating/updating/deleting trips

Photo uploads require internet connectivity and have a **30-second timeout** (using a custom `Task.withTimeout` extension).

### 3.5 Real-time Listeners

Both `FlightDataManager` and `TripManager` use Firestore `addSnapshotListener` for real-time updates. Listeners are started when the user authenticates and stopped on logout or view disappearance.

---

## 4. Data Models

### 4.1 FlightData

The core data model. Implements `Identifiable`, `Codable` with custom encode/decode for `CLLocationCoordinate2D` arrays (stored as flat `[Double]` alternating lat/lon).

| Field | Type | Description |
|---|---|---|
| `id` | String (UUID) | Unique identifier |
| `userId` | String | Owner's Firebase UID |
| `visibility` | Visibility | `.everyone` or `.justme` |
| `coordinates` | [CLLocationCoordinate2D] | Flight path track points |
| `distance` | Double | Distance in kilometers |
| `duration` | TimeInterval | Flight duration in seconds |
| `maxAltitude` | Double | Maximum altitude in meters |
| `averageSpeed` | Double | Average speed in km/h |
| `startTime` | Date | Flight start timestamp |
| `endTime` | Date | Flight end timestamp |
| `name` | String | Track name from KML/GPX (typically "ICAO1 - ICAO2" format) |
| `userTitle` | String? | User-provided title (defaults to time-based greeting) |
| `description` | String? | User-provided description |
| `registration` | String? | Aircraft registration (e.g., "SP-MKV") |
| `type` | String? | Aircraft ICAO type code (e.g., "C152") |
| `photoUrls` | [String]? | Firebase Storage paths for photos |

**Computed properties** provide aviation-standard unit conversions:
- `distanceNM` - Nautical miles
- `altitudeFeet` - Feet
- `speedKnots` - Knots
- `formattedDuration` - HH:MM:SS string

### 4.2 Trip

Groups multiple flights into a logical trip.

| Field | Type | Description |
|---|---|---|
| `id` | String (UUID) | Unique identifier |
| `userId` | String | Owner's Firebase UID |
| `name` | String | Trip name |
| `description` | String? | Optional description |
| `flightIds` | [String] | Array of flight IDs in this trip |
| `coverPhotoUrl` | String? | Cover photo URL (not yet used in UI) |
| `createdAt` | Date | Creation timestamp |
| `updatedAt` | Date | Last update timestamp |

### 4.3 Aircraft

Loaded from a bundled `icao2.plist` file containing an aircraft type database. Used for type-ahead suggestions when entering aircraft type.

| Field | Type |
|---|---|
| `icao` | String |
| `manufacturer` | String |
| `model` | String |
| `joined` | String (concatenated display string) |

### 4.4 Visibility

An enum with two cases:
- `.everyone` - Public flight, visible on feeds
- `.justme` - Private flight

---

## 5. Flight Import Pipeline

### 5.1 Supported Formats

| Format | Parser | Source |
|---|---|---|
| **KML** | `KMLParser` (XMLParserDelegate) | SkyDemon "Explore in Google Earth" export |
| **GPX** | `GPXParser` (XMLParserDelegate) | Generic GPS track format |

### 5.2 KML Import Flow (Primary Method)

1. User opens a flight log in **SkyDemon** EFB
2. User taps "Explore in Google Earth" and selects "Skytrek" from the share sheet
3. The **TrackSocialShare** extension activates:
   - Receives the KML file via `NSExtensionItem`
   - Saves it to the shared App Group container (`group.tracksocial1`)
   - Stores the filename in `UserDefaults` under `LastImportedKML`
   - Opens the main app via the `com.tracksocial://share` URL scheme
4. The main app detects activation and calls `checkForImportedKML()`:
   - Reads the KML file from the shared container
   - Parses it with `KMLParser`
   - Presents `EditFlightData` as a full-screen cover
   - Navigates to the flights tab

### 5.3 KML Parser Details

- Parses `gx:Track` elements with `gx:coord` (longitude, latitude, altitude) and `when` timestamps
- Supports ISO 8601 dates with fractional seconds
- Extracts the first `<name>` element before the track as the flight name
- Calculates: total distance, duration, max altitude, average speed

### 5.4 GPX Parser Details

- Parses `<trkpt>` elements with `lat`/`lon` attributes
- Reads `<ele>` for elevation and `<time>` for timestamps
- Extracts `<name>` element
- Same metric calculations as KML

---

## 6. User Interface

### 6.1 Tab Structure (Authenticated)

| Tab | View | Purpose |
|---|---|---|
| 0 - Trips | `TripListView` | Browse/search trips |
| 1 - Add Flight | `ImportFlightView` | Instructions for importing flights |
| 2 - My Flights | `FlightListView` | List all flights, search, select for trip creation |
| 3 - Settings | `SettingsView` | Account info, logout |

### 6.2 Authentication Flow

1. `WelcomeScreen` - Onboarding carousel with 3 pages (UIPageViewController wrapped in SwiftUI):
   - "Join the Community"
   - "Upload your flights"
   - "Share your trips"
2. "Get Started" button leads to `AuthView`
3. `AuthView` supports:
   - Email/password login
   - Email/password signup
   - Password reset via email
4. Auth state is observed via `Auth.auth().addStateDidChangeListener`

### 6.3 Flight Editing (`EditFlightData`)

A complex form with:
- **Title text field** - Pre-filled with time-based greeting (Morning/Afternoon/Evening/Night flight) based on the flight's start time and location timezone
- **Map view** - Shows the flight path with start (green) and end (red) markers
- **Description text field** - Multi-line expandable
- **Photos section** - Pick up to 5 photos from the photo library, with existing photo management
- **Aircraft details** - Registration field + type field with fuzzy search/autocomplete against the ICAO database
- **Visibility picker** - Everyone vs. Just Me
- **Flight information** - Read-only display of computed metrics
- **Save button** - With upload progress indicator and timeout handling
- **Discard button** - For new flights only, with confirmation alert

### 6.4 Aircraft Type Autocomplete

The aircraft type field has a sophisticated search system:
- **Debounced** (300ms) to avoid excessive filtering
- **Scored ranking** with priorities:
  1. Exact ICAO match (100 points)
  2. ICAO starts-with (50 points)
  3. Manufacturer/model exact word match (30 points)
  4. Starts-with partial match (20 points)
  5. Contains match (10 points)
  6. Multi-word sequence bonus (15 points per word)
- Shows top 5 results in a dropdown

### 6.5 Flight Detail View (`LogFlightView`)

Read-only view showing:
- Interactive map with polyline and start/end markers
- Photos viewer (horizontal scroll, tap for full-screen)
- Description
- Aircraft information (registration, type)
- Flight information (distance, duration, altitude, speed, times)
- Edit button in toolbar opens `EditFlightData` in editing mode

### 6.6 Trip System

**Trip List** (`TripListView`):
- Searchable list of trips
- Each row shows name, flight count, description

**Trip Creation** (two paths):
1. From `FlightListView`: Select multiple flights -> "Create Trip" button
2. Opens `CreateTripView` with name and description fields

**Trip Detail** (`TripDetailView`):
- `TripMapView` showing all flight paths with different colors
- Trip summary (name, description, flight count, date)
- Aggregate stats: total distance (NM), total duration, aerodromes visited
- List of flights with navigation to individual flight details
- Toolbar: Map editor button, Edit/Delete menu

**Trip Editing** (`EditTripView`):
- Modify name, description
- Toggle flights in/out of the trip

### 6.7 Trip Map Editor (`TripMapEditorView`)

The most complex view in the app (~1800 lines). A full map image export tool:

**Editor View:**
- Full-screen map with all flight paths drawn in distinct colors
- Location annotations with custom pins and labels (using "Montserrat-SemiBold" font)
- Resizable/draggable **crop rectangle** overlay with handle controls
- Preview button converts crop area to map coordinates

**Preview View** (`MapPreviewView`):
- Fixed-position map matching the cropped area
- **Draggable labels** - each location label can be repositioned by dragging
- **Label display modes** (cycle through): Full name, ICAO only, Name only
- **Text overlay editor** - Semi-transparent text box with:
  - Auto-generated trip summary (pilot name, registration, dates, airports, distance, duration)
  - Editable text content
  - Font size control (10-72)
  - Bold toggle
  - Text alignment (left/center)
  - Draggable positioning
- **Export** to image or share sheet:
  - Uses `PixelPerfectMapSnapshotter` (MKMapSnapshotter wrapper)
  - Renders at 1280px short dimension, max 2048px
  - Draws custom polylines, pins, labels, and text overlay on the snapshot
  - "Save to Photos" custom activity

---

## 7. Image Handling

### 7.1 Photo Upload Pipeline

1. User selects photos via `PhotosPicker` (max 5 per flight)
2. Images are resized to max 1080px dimension (accounting for screen scale)
3. Compressed to JPEG at 0.7 quality
4. Uploaded to Firebase Storage with progress tracking
5. Storage paths (not download URLs) are saved to the flight document
6. 30-second timeout; shows error on failure

### 7.2 Image Caching (`ImageCacheManager`)

- Singleton pattern
- Disk-based cache in `Library/Caches/ImageCache/`
- Keyed by URL's last path component
- Used by both `PhotosViewer` and `FlightPhotosView`

### 7.3 Photo Viewer (`PhotosViewer`)

- Loads images from Firebase Storage with retry logic (up to 5 attempts, 1-second delay)
- Shows loading spinners while fetching
- Tap opens `FullScreenImageView`:
  - Swipeable gallery (TabView with page style)
  - Pinch-to-zoom (1x-4x)
  - Double-tap to toggle 1x/2x zoom
  - Drag down to dismiss (>200px threshold)

### 7.4 Profile & Cover Images

- Uploaded via `StorageManager` (0.5 quality JPEG)
- URLs stored in Firestore `users` collection
- Profile images loaded via `ProfileImageLoader` with cache support

---

## 8. Map Components

### 8.1 Flight Maps

- Use SwiftUI `Map` with `MapPolyline` for routes
- Start/end markers with green/red tint
- Region auto-calculation based on coordinate bounds with 1.2x padding
- Map interactions disabled on feed/edit views (read-only display)

### 8.2 Trip Maps (`TripMapView`)

- Each flight drawn with a distinct color from a palette
- Location names extracted from flight name format "DEPARTURE - ARRIVAL"
- Custom pin image (`pin_stripped`) and label styling
- Sophisticated region calculation accounting for:
  - Pin annotation heights (51pt pin + 40pt label)
  - Label widths (126pt max)
  - Path bounds with 10px margin
  - Iterative adjustment when paths extend beyond annotation bounds

### 8.3 Map Snapshotter (`PixelPerfectMapSnapshotter`)

Utility class wrapping `MKMapSnapshotter` for pixel-perfect image export:
- Configurable camera, mapRect, size, scale, mapType, traitCollection
- Drawing helpers for polylines, pins, and labels
- Used by the trip map export feature

---

## 9. Share Extension (`TrackSocialShare`)

- Registered for `com.google.earth.kml` UTType
- Declared as a share extension (`com.apple.share-services`)
- Accepts files and web URLs (max 1 each)
- Uses a storyboard-based UI (`MainInterface.storyboard`)
- Shares data with the main app via:
  - **App Group container** (`group.tracksocial1`) for the KML file
  - **UserDefaults** (shared suite) for the filename
  - **Custom URL scheme** (`com.tracksocial://share`) to open the main app

---

## 10. Custom Fonts & Assets

### 10.1 Fonts
- **Montserrat-SemiBold** - Used for map labels in trip views

### 10.2 Asset Images
- `pin` / `pin_stripped` - Custom map pin icons
- `skytrek` - App branding image
- `1`, `1a`, `2`, `3`, `3a`, `3b`, `4` - Welcome screen/onboarding photos
- `b` - Additional image asset
- `defaultCoverPhoto` - Default cover photo for profiles
- `Marcin2` - Developer photo
- `Image`, `Image 1` - Additional image assets
- **App Icon** - DALL-E generated: orange background with white Cessna silhouette

### 10.3 Branding Colors
- **Orange:** RGB(252, 82, 0) - Primary accent color (`CustomColors.orangeColor`)
- **Grey:** RGB(20, 20, 20) - Dark background (`CustomColors.greyColor`)

---

## 11. Third-Party Dependencies

| Dependency | Purpose |
|---|---|
| Firebase (Core, Auth, Firestore, Storage, AppCheck) | Backend services |
| YouTubeiOSPlayerHelper | Embedded YouTube tutorial video player |
| LinkPresentation | Rich share sheet metadata |

---

## 12. Notable Technical Details

### 12.1 Coordinate Serialization
`CLLocationCoordinate2D` arrays are serialized to flat `[Double]` arrays (alternating lat/lon) for Firestore storage, since `CLLocationCoordinate2D` doesn't conform to `Codable`.

### 12.2 Time-Based Greeting
The `EditFlightData` view generates contextual titles based on the flight's local time:
- Uses reverse geocoding to determine timezone from the flight's starting coordinate
- Falls back to device timezone if geocoding fails
- Semaphore-based synchronous geocoding call (100ms timeout)

### 12.3 Task Timeout Extension
Custom `Task.withTimeout()` using `withThrowingTaskGroup` - races the actual operation against a sleep timer. Used for photo upload timeout handling.

### 12.4 Array Deduplication
Custom `Array.unique(by:)` extension using a `Set` with `KeyPath` for removing duplicates. Used when loading aircraft data from the ICAO plist.

### 12.5 Dual App Targets
There are two `@main` app entry points:
- `TrackSocial/TrackSocialApp.swift` - Current active version (has Trip support, debug AppCheck, offline persistence)
- `TrackSocialApp/TrackSocialApp.swift` - Legacy version (no Trip support, production AppCheck, no edit-before-save flow)

---

## 13. Current State & Observations

### 13.1 Features That Work
- Full flight import pipeline (KML from SkyDemon via share extension)
- Flight viewing, editing, and deletion
- Photo upload/download with caching
- Trip creation, editing, deletion
- Trip map visualization with multi-flight colored paths
- Sophisticated trip map export with draggable labels and text overlay
- Email/password auth with password reset
- Offline-first architecture with Firebase persistence
- Aircraft type autocomplete from ICAO database

### 13.2 Work in Progress / Incomplete
- **Feed View** (`FeedView`) exists but is not in the active tab bar - was likely intended as a social feed showing public flights
- **Profile View** (`ProfileView`) exists but is not in the active tab bar - contains hardcoded mock data ("John Doe", mock stats, mock achievements)
- **"Add from File" button** in `ImportFlightView` has no action connected (placeholder)
- **Tests** are scaffolded but empty
- **GPX import** is implemented in the parser but no UI path exists for it (only KML via share extension)
- **Visibility setting** exists in the data model and UI but there's no server-side enforcement or feed filtering visible
- `ShareExtension/ShareViewController.swift` is empty (the actual share extension is `TrackSocialShare`)
- Pilot name in trip map export is hardcoded to "Marcin Kmiec"

### 13.3 Potential Issues
- Firebase API key and project details are committed to the repo (GoogleService-Info.plist)
- The `TrackSocialApp` duplicate target could cause confusion
- `UIScreen.main` usage is deprecated in newer iOS versions
- Some print statements with debug emojis throughout the codebase
- Force unwrap of `Auth.auth().currentUser!.uid` in both parsers could crash if called without authentication
