class RealtimeCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input=inputs[0]?.[0];
    if(input){const copy=new Float32Array(input);this.port.postMessage(copy,[copy.buffer]);}
    return true;
  }
}
registerProcessor('demotif-realtime-capture',RealtimeCapture);
