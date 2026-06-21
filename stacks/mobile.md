# Mobile Stack Configuration

## Language
Kotlin

## Framework
Kotlin Multiplatform + Compose Multiplatform (Android & iOS)

## Hard Skills
Kotlin, Kotlin Multiplatform, Compose Multiplatform, Ktor, Coroutines, Clean Architecture, kotlin.test

## Code Style & Principles
- Clean Architecture (data / domain / presentation layers)
- Repository pattern
- ViewModel + StateFlow for UI state
- Dependency injection with Koin

## Base Architecture (optional)
<!-- Paste a GitHub URL to a reference architecture you want to follow -->
<!-- Example: https://github.com/user/kmp-clean-architecture -->

## Rules
- All code must live under `mobile/` with Gradle build files
- Network layer using **Ktor** based on the API documentation provided
- Shared logic in `commonMain`, platform-specific in `androidMain` / `iosMain`
- Minimum 3 unit tests using **kotlin.test** in `commonTest`
- `gradlew` must be present and executable
