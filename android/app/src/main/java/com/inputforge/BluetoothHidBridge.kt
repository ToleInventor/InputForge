package com.inputforge

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.os.Handler
import android.os.Looper

class BluetoothHidBridge(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "BluetoothHidBridge"
    }

    @ReactMethod
    fun initializeEngine() {
        Handler(Looper.getMainLooper()).post {
            val engine = BluetoothHidEngine.initialize(reactContext)
            engine.setConnectionStateListener { state ->
                if (reactContext.hasActiveReactInstance()) {
                    reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("BluetoothHidConnectionState", state)
                }
            }
            engine.setupProfileProxy(reactContext)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by React Native's native event emitter contract.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required by React Native's native event emitter contract.
    }

    @ReactMethod
    fun sendRawPayload(hexPayload: String, reportId: Int, promise: Promise) {
        val sent = BluetoothHidEngine.getInstance()?.sendPayload(hexPayload, reportId) ?: false
        promise.resolve(sent)
    }

}
