import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing is configured only from the environment used by the release
// workflow (see .github/workflows/release-draft.yml). No key material, path or
// password is stored in this repository. Values are never logged.
val releaseSigningVariableNames = listOf(
    "THINGARY_ANDROID_KEYSTORE",
    "THINGARY_ANDROID_KEYSTORE_PASSWORD",
    "THINGARY_ANDROID_KEY_ALIAS",
    "THINGARY_ANDROID_KEY_PASSWORD",
)
val releaseSigningValues = releaseSigningVariableNames.associateWith { System.getenv(it) }
val missingReleaseSigningVariableNames = releaseSigningVariableNames
    .filter { releaseSigningValues[it].isNullOrBlank() }
val releaseKeystore = releaseSigningValues["THINGARY_ANDROID_KEYSTORE"]
    ?.takeIf { it.isNotBlank() }
    ?.let { file(it) }
val releaseKeystoreExists = releaseKeystore?.exists() == true
val releaseSigningConfigured = missingReleaseSigningVariableNames.isEmpty() && releaseKeystoreExists
if (!releaseSigningConfigured) {
    val missing = missingReleaseSigningVariableNames.toMutableList()
    // Name the path variable too when it is set but points at no keystore.
    if (releaseSigningValues["THINGARY_ANDROID_KEYSTORE"]?.isNotBlank() == true && !releaseKeystoreExists) {
        missing.add("THINGARY_ANDROID_KEYSTORE (file not found)")
    }
    logger.warn(
        "Thingary: release signing is not configured; the release APK will be unsigned. " +
            "Missing or invalid: ${missing.joinToString()}."
    )
}

android {
    compileSdk = 37
    namespace = "local.thingary.preview"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        // The preview identity is the default; a release build sets THINGARY_ANDROID_APPLICATION_ID
        // (and THINGARY_ANDROID_APP_LABEL). The Kotlin plugin classes stay in the source package.
        applicationId = System.getenv("THINGARY_ANDROID_APPLICATION_ID") ?: "local.thingary.preview"
        manifestPlaceholders["appLabel"] = System.getenv("THINGARY_ANDROID_APP_LABEL") ?: "Thingary Preview"
        minSdk = 29
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = releaseSigningValues["THINGARY_ANDROID_KEYSTORE_PASSWORD"]
                keyAlias = releaseSigningValues["THINGARY_ANDROID_KEY_ALIAS"]
                keyPassword = releaseSigningValues["THINGARY_ANDROID_KEY_PASSWORD"]
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
