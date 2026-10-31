package com.inputforge

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHidDevice
import android.bluetooth.BluetoothHidDeviceAppSdpSettings
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.Executors

class BluetoothHidEngine private constructor(context: Context) {
    private val appContext = context.applicationContext
    private val preferences: SharedPreferences =
        appContext.getSharedPreferences("bluetooth_hid", Context.MODE_PRIVATE)
    @Volatile private var mHidDevice: BluetoothHidDevice? = null
    @Volatile private var mConnectedDevice: BluetoothDevice? = null
    @Volatile private var mProfileProxyRequested = false
    @Volatile private var mAppRegistered = false
    @Volatile private var mRegistrationPending = false
    @Volatile private var mReconnectScheduled = false
    @Volatile private var currentConnectionState = "disconnected"
    @Volatile private var connectionStateListener: ((String) -> Unit)? = null
    private val callbackExecutor = Executors.newSingleThreadExecutor()
    private val reconnectHandler = Handler(Looper.getMainLooper())


    // Universal Standard 104-key USB Keyboard HID Descriptor Registry Array
    private val HID_DESCRIPTOR = byteArrayOf(
        0x05.toByte(), 0x01.toByte(), 0x09.toByte(), 0x06.toByte(), 0xa1.toByte(), 0x01.toByte(),
        0x85.toByte(), 0x01.toByte(), 0x05.toByte(), 0x07.toByte(), 0x19.toByte(), 0xe0.toByte(),
        0x29.toByte(), 0xe7.toByte(), 0x15.toByte(), 0x00.toByte(), 0x25.toByte(), 0x01.toByte(),
        0x75.toByte(), 0x01.toByte(), 0x95.toByte(), 0x08.toByte(), 0x81.toByte(), 0x02.toByte(),
        0x95.toByte(), 0x01.toByte(), 0x75.toByte(), 0x08.toByte(), 0x81.toByte(), 0x03.toByte(),
        0x95.toByte(), 0x06.toByte(), 0x75.toByte(), 0x08.toByte(), 0x15.toByte(), 0x00.toByte(),
        0x25.toByte(), 0x65.toByte(), 0x19.toByte(), 0x00.toByte(), 0x29.toByte(), 0x65.toByte(),
        0x81.toByte(), 0x00.toByte(), 0xc0.toByte()
    )

    fun setConnectionStateListener(listener: (String) -> Unit) {
        connectionStateListener = listener
        listener(currentConnectionState)
    }

    private fun updateConnectionState(state: String) {
        currentConnectionState = state
        connectionStateListener?.invoke(state)
    }

    fun setupProfileProxy(context: Context) {
        val existingHid = mHidDevice
        if (existingHid != null) {
            if (mAppRegistered) {
                reconnectLastDevice(existingHid)
            } else if (!mRegistrationPending) {
                registerHidApp(existingHid)
            }
            return
        }
        if (mProfileProxyRequested) return

        try {
            updateConnectionState("connecting")
            val adapter = BluetoothAdapter.getDefaultAdapter()
            if (adapter == null) {
                updateConnectionState("error")
                Log.e("HID_ENGINE", "Bluetooth adapter unavailable")
                return
            }

            mProfileProxyRequested = true

            val requested = adapter.getProfileProxy(context, object : BluetoothProfile.ServiceListener {
                override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                    if (profile == BluetoothProfile.HID_DEVICE) {
                        val hid = proxy as BluetoothHidDevice
                        mHidDevice = hid
                        registerHidApp(hid)
                    }
                }
                override fun onServiceDisconnected(profile: Int) {
                    if (profile == BluetoothProfile.HID_DEVICE) {
                        mHidDevice = null
                        mAppRegistered = false
                        mRegistrationPending = false
                        mProfileProxyRequested = false
                        mConnectedDevice = null
                        updateConnectionState("disconnected")
                        Log.w("HID_ENGINE", "HID profile service disconnected")
                    }
                }
            }, BluetoothProfile.HID_DEVICE)
            if (!requested) {
                mProfileProxyRequested = false
                updateConnectionState("error")
                Log.e("HID_ENGINE", "Failed to request Bluetooth HID profile proxy")
            }
        } catch (e: SecurityException) {
            mProfileProxyRequested = false
            updateConnectionState("error")
            Log.e("HID_ENGINE", "Security exception setting up profile layout proxy", e)
        }
    }

    private fun registerHidApp(hid: BluetoothHidDevice) {
        try {
            // Subclass 0x40 with standard keyboard flag enables keyboard HID behavior.
            val sdp = BluetoothHidDeviceAppSdpSettings(
                "InputForge Keyboard",
                "InputForge Virtual Keyboard Peripheral",
                "InputForge",
                0x40.toByte(),
                HID_DESCRIPTOR
            )
            mRegistrationPending = hid.registerApp(sdp, null, null, callbackExecutor, mCallback)
            if (!mRegistrationPending) {
                updateConnectionState("error")
                Log.e("HID_ENGINE", "HID app registration request failed")
            }
        } catch (e: SecurityException) {
            mRegistrationPending = false
            updateConnectionState("error")
            Log.e("HID_ENGINE", "Bluetooth permission required to register HID app", e)
        }
    }

    private val mCallback = object : BluetoothHidDevice.Callback() {
        override fun onAppStatusChanged(pluggedDevice: BluetoothDevice?, registered: Boolean) {
            super.onAppStatusChanged(pluggedDevice, registered)
            mRegistrationPending = false
            mAppRegistered = registered
            Log.i("HID_ENGINE", "HID app registration status: $registered")
            if (registered) {
                if (pluggedDevice != null) {
                    mConnectedDevice = pluggedDevice
                    preferences.edit().putString("last_host_address", pluggedDevice.address).apply()
                    mReconnectScheduled = false
                    updateConnectionState("connected")
                } else {
                    updateConnectionState("disconnected")
                    mHidDevice?.let { reconnectLastDevice(it) }
                }
            } else {
                updateConnectionState("error")
            }
        }

        override fun onConnectionStateChanged(device: BluetoothDevice, state: Int) {
            super.onConnectionStateChanged(device, state)
            when (state) {
                BluetoothProfile.STATE_CONNECTED -> {
                    mConnectedDevice = device
                    mReconnectScheduled = false
                    preferences.edit().putString("last_host_address", device.address).apply()
                    updateConnectionState("connected")
                    Log.i("HID_ENGINE", "Connected to Bluetooth host: ${device.name}")
                }
                BluetoothProfile.STATE_CONNECTING -> updateConnectionState("connecting")
                BluetoothProfile.STATE_DISCONNECTED -> {
                    if (mConnectedDevice?.address == device.address) mConnectedDevice = null
                    updateConnectionState("disconnected")
                    if (mAppRegistered) scheduleReconnect()
                    Log.w("HID_ENGINE", "Bluetooth host disconnected: ${device.name}")
                }
            }
        }
    }

    private fun reconnectLastDevice(hid: BluetoothHidDevice) {
        try {
            val adapter = BluetoothAdapter.getDefaultAdapter()
            if (adapter == null) {
                updateConnectionState("error")
                Log.e("HID_ENGINE", "Bluetooth adapter unavailable during reconnect")
                return
            }
            val connectedDevice = hid.connectedDevices.firstOrNull()
            if (connectedDevice != null) {
                mConnectedDevice = connectedDevice
                updateConnectionState("connected")
                return
            }
            mConnectedDevice = null

            val address = preferences.getString("last_host_address", null)
            if (address == null) {
                updateConnectionState("disconnected")
                Log.w("HID_ENGINE", "No previously connected host is saved; pair from the computer")
                return
            }

            val device = adapter.getRemoteDevice(address)
            if (!adapter.bondedDevices.contains(device)) {
                updateConnectionState("disconnected")
                Log.w("HID_ENGINE", "Saved host is no longer paired")
                return
            }
            updateConnectionState("connecting")
            if (!hid.connect(device)) {
                updateConnectionState("disconnected")
                scheduleReconnect()
                Log.w("HID_ENGINE", "Bluetooth reconnect request was rejected")
            } else {
                scheduleReconnect()
                Log.i("HID_ENGINE", "Bluetooth reconnect requested for ${device.name}")
            }
        } catch (e: SecurityException) {
            updateConnectionState("error")
            Log.e("HID_ENGINE", "Bluetooth permission required to reconnect", e)
        } catch (e: IllegalArgumentException) {
            updateConnectionState("error")
            Log.e("HID_ENGINE", "Saved Bluetooth host address is invalid", e)
        }
    }

    private fun scheduleReconnect() {
        if (mReconnectScheduled || !mAppRegistered) return
        mReconnectScheduled = true
        reconnectHandler.postDelayed({
            mReconnectScheduled = false
            val hid = mHidDevice
            if (hid != null && mAppRegistered && mConnectedDevice == null) {
                reconnectLastDevice(hid)
            }
        }, 5_000)
    }

    fun sendPayload(hexPayload: String, reportId: Int): Boolean {
        val hid = mHidDevice ?: return false
        val dev = mConnectedDevice ?: return false
        try {
            if (reportId != 1 || hexPayload.length != 16 || hexPayload.any { Character.digit(it, 16) < 0 }) {
                Log.e("HID_ENGINE", "Invalid keyboard report")
                return false
            }
            val bytes = hexStringToByteArray(hexPayload)
            // Report ID 1 is explicitly specified for our keyboard descriptor matching keys
            return hid.sendReport(dev, reportId, bytes)
        } catch (e: Exception) {
            Log.e("HID_ENGINE", "Failed to send HID report", e)
            return false
        }
    }

    private fun hexStringToByteArray(s: String): ByteArray {
        val len = s.length
        val data = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            data[i / 2] = ((Character.digit(s[i], 16) shl 4) + Character.digit(s[i + 1], 16)).toByte()
            i += 2
        }
        return data
    }

    companion object {
        private var instance: BluetoothHidEngine? = null
        fun initialize(context: Context): BluetoothHidEngine {
            if (instance == null) instance = BluetoothHidEngine(context.applicationContext)
            return instance!!
        }
        fun getInstance(): BluetoothHidEngine? = instance
    }
}
