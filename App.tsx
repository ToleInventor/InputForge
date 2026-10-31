
import React, {useEffect, useRef, useState} from 'react';

import {
  Alert,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  NativeModules,
} from 'react-native';

// --------------------------------------------------
// Native Bluetooth HID bridge
// --------------------------------------------------

interface BluetoothHidBridgeType {
  initializeEngine: () => void | Promise<void>;
  sendRawPayload: (payload: string, type: number) => void | Promise<void>;
}

const {BluetoothHidBridge} = NativeModules as {
  BluetoothHidBridge?: BluetoothHidBridgeType;
};

// --------------------------------------------------
// HID character mapping
// --------------------------------------------------

interface CharacterMapping {
  key: string;
  shift?: boolean;
}

const HID_KEYS: Record<string, CharacterMapping> = {
  // Letters
  a: {key: '04'}, b: {key: '05'}, c: {key: '06'},
  d: {key: '07'}, e: {key: '08'}, f: {key: '09'},
  g: {key: '0A'}, h: {key: '0B'}, i: {key: '0C'},
  j: {key: '0D'}, k: {key: '0E'}, l: {key: '0F'},
  m: {key: '10'}, n: {key: '11'}, o: {key: '12'},
  p: {key: '13'}, q: {key: '14'}, r: {key: '15'},
  s: {key: '16'}, t: {key: '17'}, u: {key: '18'},
  v: {key: '19'}, w: {key: '1A'}, x: {key: '1B'},
  y: {key: '1C'}, z: {key: '1D'},

  // Uppercase letters
  A: {key: '04', shift: true},
  B: {key: '05', shift: true},
  C: {key: '06', shift: true},
  D: {key: '07', shift: true},
  E: {key: '08', shift: true},
  F: {key: '09', shift: true},
  G: {key: '0A', shift: true},
  H: {key: '0B', shift: true},
  I: {key: '0C', shift: true},
  J: {key: '0D', shift: true},
  K: {key: '0E', shift: true},
  L: {key: '0F', shift: true},
  M: {key: '10', shift: true},
  N: {key: '11', shift: true},
  O: {key: '12', shift: true},
  P: {key: '13', shift: true},
  Q: {key: '14', shift: true},
  R: {key: '15', shift: true},
  S: {key: '16', shift: true},
  T: {key: '17', shift: true},
  U: {key: '18', shift: true},
  V: {key: '19', shift: true},
  W: {key: '1A', shift: true},
  X: {key: '1B', shift: true},
  Y: {key: '1C', shift: true},
  Z: {key: '1D', shift: true},

  // Numbers
  '1': {key: '1E'}, '2': {key: '1F'},
  '3': {key: '20'}, '4': {key: '21'},
  '5': {key: '22'}, '6': {key: '23'},
  '7': {key: '24'}, '8': {key: '25'},
  '9': {key: '26'}, '0': {key: '27'},

  // Shifted numbers
  '!': {key: '1E', shift: true},
  '@': {key: '1F', shift: true},
  '#': {key: '20', shift: true},
  '$': {key: '21', shift: true},
  '%': {key: '22', shift: true},
  '^': {key: '23', shift: true},
  '&': {key: '24', shift: true},
  '*': {key: '25', shift: true},
  '(': {key: '26', shift: true},
  ')': {key: '27', shift: true},

  // Punctuation
  '-': {key: '2D'},
  '=': {key: '2E'},
  '[': {key: '2F'},
  ']': {key: '30'},
  '\\': {key: '31'},
  ';': {key: '33'},
  "'": {key: '34'},
  '`': {key: '35'},
  ',': {key: '36'},
  '.': {key: '37'},
  '/': {key: '38'},

  // Shifted punctuation
  '_': {key: '2D', shift: true},
  '+': {key: '2E', shift: true},
  '{': {key: '2F', shift: true},
  '}': {key: '30', shift: true},
  '|': {key: '31', shift: true},
  ':': {key: '33', shift: true},
  '"': {key: '34', shift: true},
  '~': {key: '35', shift: true},
  '<': {key: '36', shift: true},
  '>': {key: '37', shift: true},
  '?': {key: '38', shift: true},

  // Other characters
  ' ': {key: '2C'},
  '\n': {key: '28'},
  '\t': {key: '2B'},
};

// --------------------------------------------------
// Timing helpers
// --------------------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

const randomBetween = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// --------------------------------------------------
// Main component
// --------------------------------------------------

export default function App(): React.JSX.Element {
  const [textInput, setTextInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [status, setStatus] = useState('Ready');

  // Current position exists only during this app session.
  const currentIndex = useRef(0);

  // Changing this value cancels the current typing loop.
  const sessionId = useRef(0);

  const mounted = useRef(true);

  // ------------------------------------------------
  // Bluetooth initialization and permissions
  // ------------------------------------------------

  useEffect(() => {
    mounted.current = true;

    const initializeBluetooth = async () => {
      if (!BluetoothHidBridge) {
        Alert.alert(
          'Bluetooth unavailable',
          'The Bluetooth HID native module could not be found.',
        );
        return;
      }

      try {
        if (Platform.OS === 'android' && Platform.Version >= 31) {
          const permissions = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          ]);

          const connectGranted =
            permissions[
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
            ] === PermissionsAndroid.RESULTS.GRANTED;

          const advertiseGranted =
            permissions[
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE
            ] === PermissionsAndroid.RESULTS.GRANTED;

          if (!connectGranted || !advertiseGranted) {
            Alert.alert(
              'Permission required',
              'Bluetooth permissions are required to use this feature.',
            );
            return;
          }
        }

        await BluetoothHidBridge.initializeEngine();
      } catch (error) {
        console.warn('Bluetooth initialization failed:', error);
        Alert.alert(
          'Initialization failed',
          'Unable to initialize the Bluetooth HID connection.',
        );
      }
    };

    initializeBluetooth();

    return () => {
      mounted.current = false;
      sessionId.current += 1;
    };
  }, []);

  // ------------------------------------------------
  // Send a HID keyboard report
  // ------------------------------------------------

  const sendRawPayload = async (payload: string): Promise<void> => {
    if (!BluetoothHidBridge) {
      throw new Error('Bluetooth HID bridge is unavailable.');
    }

    await BluetoothHidBridge.sendRawPayload(payload, 1);
  };

  // ------------------------------------------------
  // Send one character
  // ------------------------------------------------

  const sendCharacter = async (character: string): Promise<boolean> => {
    const mapping = HID_KEYS[character];

    if (!mapping) {
      // Unsupported characters are skipped.
      return true;
    }

    const modifier = mapping.shift ? '02' : '00';

    const keyDown = `${modifier}00${mapping.key}0000000000`;
    const keyUp = `${modifier}00000000000000`;

    await sendRawPayload(keyDown);

    // Keep the key pressed briefly.
    await sleep(35);

    // Always release the key before proceeding.
    await sendRawPayload(keyUp);

    return true;
  };

  // ------------------------------------------------
  // Human-like typing delay
  // ------------------------------------------------

  const getTypingDelay = (character: string): number => {
    let delay = randomBetween(220, 480);

    // Occasionally type a little faster.
    if (Math.random() < 0.12) {
      delay = randomBetween(120, 200);
    }

    // Occasionally slow down.
    if (Math.random() < 0.18) {
      delay = randomBetween(500, 850);
    }

    // Natural pauses around punctuation.
    if (['.', ',', '!', '?', ';', ':'].includes(character)) {
      delay += randomBetween(350, 750);
    }

    // Slight pause after spaces.
    if (character === ' ') {
      delay += randomBetween(40, 130);
    }

    return delay;
  };

  // ------------------------------------------------
  // Random pauses
  // ------------------------------------------------

  const randomPause = async (
    activeSession: number,
  ): Promise<boolean> => {
    const pauseDuration = randomBetween(1500, 3500);
    const interval = 100;

    let elapsed = 0;

    while (elapsed < pauseDuration) {
      if (sessionId.current !== activeSession) {
        return false;
      }

      const step = Math.min(interval, pauseDuration - elapsed);
      await sleep(step);
      elapsed += step;
    }

    return sessionId.current === activeSession;
  };

  // ------------------------------------------------
  // Typing loop
  // ------------------------------------------------

  const startTyping = async (): Promise<void> => {
    if (isTyping) {
      return;
    }

    if (!BluetoothHidBridge) {
      Alert.alert(
        'Bluetooth unavailable',
        'The Bluetooth HID bridge is not initialized.',
      );
      return;
    }

    if (!textInput.trim()) {
      Alert.alert('Empty text', 'Enter some text before starting.');
      return;
    }

    // If the previous message is complete, start from the beginning.
    if (currentIndex.current >= textInput.length) {
      currentIndex.current = 0;
    }

    const activeSession = ++sessionId.current;
    const message = textInput;

    setIsTyping(true);
    setStatus('Typing');

    try {
      let charactersSincePause = 0;
      let nextPauseAt = randomBetween(25, 45);

      while (currentIndex.current < message.length) {
        if (sessionId.current !== activeSession) {
          break;
        }

        const index = currentIndex.current;
        const character = message[index];

        // Complete the current character before advancing.
        await sendCharacter(character);

        if (sessionId.current !== activeSession) {
          break;
        }

        currentIndex.current += 1;
        charactersSincePause += 1;

        if (currentIndex.current >= message.length) {
          break;
        }

        // Random longer pauses during longer messages.
        if (charactersSincePause >= nextPauseAt) {
          const continued = await randomPause(activeSession);

          if (!continued) {
            break;
          }

          charactersSincePause = 0;
          nextPauseAt = randomBetween(25, 45);
        }

        // Ordinary character delay.
        const delay = getTypingDelay(character);

        let elapsed = 0;

        while (elapsed < delay) {
          if (sessionId.current !== activeSession) {
            break;
          }

          const step = Math.min(100, delay - elapsed);
          await sleep(step);
          elapsed += step;
        }
      }

      if (sessionId.current === activeSession) {
        if (currentIndex.current >= message.length) {
          setStatus('Completed');
          currentIndex.current = message.length;
        } else {
          setStatus('Paused');
        }
      }
    } catch (error) {
      console.warn('Typing failed:', error);

      if (sessionId.current === activeSession) {
        setStatus('Error');
        Alert.alert(
          'Transmission error',
          'An error occurred while sending the text.',
        );
      }
    } finally {
      if (sessionId.current === activeSession) {
        setIsTyping(false);
      }
    }
  };

  // ------------------------------------------------
  // Stop / pause transmission
  // ------------------------------------------------

  const stopTyping = (): void => {
    if (!isTyping) {
      return;
    }

    // Invalidate the active typing loop.
    sessionId.current += 1;

    setIsTyping(false);
    setStatus('Paused');

    // Release all keyboard keys.
    if (BluetoothHidBridge) {
      BluetoothHidBridge.sendRawPayload(
        '0000000000000000',
        1,
      );
    }
  };

  // ------------------------------------------------
  // Text editing
  // ------------------------------------------------

  const handleTextChange = (value: string): void => {
    // Cancel any active transmission.
    sessionId.current += 1;

    currentIndex.current = 0;

    setTextInput(value);
    setIsTyping(false);
    setStatus('Ready');

    // Release any potentially held key.
    if (BluetoothHidBridge) {
      BluetoothHidBridge.sendRawPayload(
        '0000000000000000',
        1,
      );
    }
  };

  // ------------------------------------------------
  // UI
  // ------------------------------------------------

  return (
    <SafeAreaView style={styles.safe}>
      <Text>
        Ready
      </Text>
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          placeholder="Enter text to transmit..."
          placeholderTextColor="#6e7681"
          value={textInput}
          onChangeText={handleTextChange}
          multiline
          textAlignVertical="top"
          editable={!isTyping}
          autoCorrect={false}
          spellCheck={false}
          selectionColor="#58a6ff"
        />

        <View style={styles.footer}>
          <Text style={styles.status}>
            {status}
          </Text>

          <View style={styles.controls}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.button,
                styles.startButton,
                isTyping && styles.disabledButton,
              ]}
              onPress={startTyping}
              disabled={isTyping}>
              <Text style={styles.buttonText}>
                START
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.button,
                styles.stopButton,
                !isTyping && styles.disabledButton,
              ]}
              onPress={stopTyping}
              disabled={!isTyping}>
              <Text style={styles.buttonText}>
                STOP
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// --------------------------------------------------
// Styles
// --------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0d1117',
    marginTop: 40,
  },

  container: {
    flex: 1,
    padding: 14,
  },

  input: {
    flex: 1,
    backgroundColor: '#161b22',
    color: '#e6edf3',
    fontSize: 16,
    lineHeight: 25,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#30363d',
    textAlignVertical: 'top',
  },

  footer: {
    marginTop: 14,
  },

  status: {
    color: '#8b949e',
    fontSize: 12,
    marginBottom: 12,
    textAlign: 'center',
  },

  controls: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 50,
  },

  button: {
    flex: 1,
    height: 54,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },

  startButton: {
    backgroundColor: '#238636',
  },

  stopButton: {
    backgroundColor: '#da3633',
  },

  disabledButton: {
    opacity: 0.4,
  },

  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,

  },
});
