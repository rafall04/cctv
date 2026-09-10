/*
Purpose: In-memory registry of LIVE-TALK sinks for Titik Speaker nodes. When an operator pages (push-to-talk)
         to a speaker node, the node opens an HTTP chunked stream (GET /node/stream) and this registry holds
         that open response as a "sink". The browser talk WS then writes each mic frame (u-law 16k) to every
         sink of the targeted devices, so the node plays it live via `aplay -f MU_LAW`. Half-duplex (node
         only receives). Single-process (fork) like cameraAudioLock — move to a broker if it ever clusters.
Caller: audioDeviceController (GET /node/stream registers a sink), audioTalkService (writes frames / ends).
MainFuncs: addSink, removeSink, hasSink, writeToDevice, endDeviceTalk.
SideEffects: none beyond the in-memory map; writing pushes bytes to held HTTP responses.
*/

const sinks = new Map(); // deviceId -> Set<{ write(buf), end() }>

export function addSink(deviceId, sink) {
    const id = parseInt(deviceId, 10);
    if (!sinks.has(id)) sinks.set(id, new Set());
    sinks.get(id).add(sink);
}

export function removeSink(deviceId, sink) {
    const id = parseInt(deviceId, 10);
    const set = sinks.get(id);
    if (!set) return;
    set.delete(sink);
    if (set.size === 0) sinks.delete(id);
}

export function hasSink(deviceId) {
    return sinks.has(parseInt(deviceId, 10));
}

/** Push a live audio frame to every open sink of a device. Returns how many sinks received it. */
export function writeToDevice(deviceId, buf) {
    const set = sinks.get(parseInt(deviceId, 10));
    if (!set) return 0;
    let n = 0;
    for (const sink of set) {
        try { sink.write(buf); n += 1; } catch { /* broken pipe — its close handler will deregister it */ }
    }
    return n;
}

/** End talk for a device: close every open sink (the node's aplay gets EOF and stops). */
export function endDeviceTalk(deviceId) {
    const id = parseInt(deviceId, 10);
    const set = sinks.get(id);
    if (!set) return;
    for (const sink of [...set]) {
        try { sink.end(); } catch { /* already closed */ }
    }
    sinks.delete(id);
}

export default { addSink, removeSink, hasSink, writeToDevice, endDeviceTalk };
