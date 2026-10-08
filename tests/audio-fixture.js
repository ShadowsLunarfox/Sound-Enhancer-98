const context = new AudioContext();
const oscillator = context.createOscillator();
const gain = context.createGain();
gain.gain.value = 0.01;
oscillator.frequency.value = 440;
oscillator.connect(gain).connect(context.destination);
oscillator.start();
context.resume();
