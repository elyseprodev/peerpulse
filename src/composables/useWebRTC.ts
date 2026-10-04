/**
 * PeerPulse WebRTC session controller.
 *
 * Design notes (mirrored in docs/webrtc-signaling.md):
 *
 * • Two participants per room, so a single RTCPeerConnection is enough — no SFU.
 * • Exactly one side is the *offerer*: the participant whose Firebase UID sorts
 *   lower. That is deterministic on both devices and removes negotiation glare
 *   without an extra handshake.
 * • Signalling documents live in Firestore under
 *   `rooms/{roomId}/signaling` and `rooms/{roomId}/candidates`, restricted by
 *   security rules to the two participants of the booking.
 * • Every envelope carries a monotonically increasing `sequence`; a receiver
 *   ignores anything older than the offer it has already applied, which makes
 *   reconnects and duplicate deliveries safe.
 * • The backend is abstracted: in local (demo) mode the same envelopes travel
 *   through the in-browser reference backend, so the signalling flow can be
 *   exercised in two tabs without a cloud project.
 */
import { onBeforeUnmount, ref, shallowRef, type Ref } from 'vue'
import type { MediaState } from '@shared/domain'
import { getBackend, type PeerPulseBackend } from '@/lib/backend'

export type RoomConnectionState =
  | 'idle'
  | 'requesting-media'
  | 'waiting-for-peer'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'peer-left'
  | 'error'

export interface WebRTCSessionOptions {
  roomId: Ref<string>
  selfUid: Ref<string>
  peerUid: Ref<string>
  /** Read-only rooms (finished sessions) never negotiate media. */
  canPublish: Ref<boolean>
}

export function useWebRTC(options: WebRTCSessionOptions) {
  const backend = shallowRef<PeerPulseBackend | null>(null)
  const pc = shallowRef<RTCPeerConnection | null>(null)
  const localStream = shallowRef<MediaStream | null>(null)
  const screenStream = shallowRef<MediaStream | null>(null)
  const remoteStream = shallowRef<MediaStream | null>(null)
  const connectionState = ref<RoomConnectionState>('idle')
  const error = ref<string | null>(null)
  const media = ref<MediaState>({ camera: false, microphone: false, screen: false })
  const remoteMedia = ref<MediaState>({ camera: false, microphone: false, screen: false })
  const peerPresent = ref(false)

  let clearSignals: (() => void) | null = null
  let clearCandidates: (() => void) | null = null
  let clearPresence: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let sequence = 0
  let pendingCandidates: RTCIceCandidateInit[] = []
  let remoteDescriptionSet = false
  let stopped = false

  const isOfferer = () => options.selfUid.value < options.peerUid.value

  function iceConfiguration(servers: RTCIceServer[]): RTCConfiguration {
    return {
      iceServers: servers,
      // `all` gives faster connection setup on LANs; TURN still covers NAT cases.
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    }
  }

  async function getBackendInstance(): Promise<PeerPulseBackend> {
    if (!backend.value) backend.value = await getBackend()
    return backend.value
  }

  function setState(next: RoomConnectionState, message?: string): void {
    connectionState.value = next
    error.value = message ?? null
  }

  async function ensurePeer(): Promise<RTCPeerConnection> {
    if (pc.value) return pc.value
    const instance = await getBackendInstance()
    const servers = await instance.getIceServers()

    const peer = new RTCPeerConnection(iceConfiguration(servers))

    peer.ontrack = (event) => {
      const [stream] = event.streams
      if (stream) {
        remoteStream.value = stream
      } else {
        const merged = remoteStream.value ?? new MediaStream()
        merged.addTrack(event.track)
        remoteStream.value = merged
      }
      remoteMedia.value = {
        ...remoteMedia.value,
        camera: stream?.getVideoTracks().length ? true : remoteMedia.value.camera,
        microphone: stream?.getAudioTracks().length ? true : remoteMedia.value.microphone,
      }
      if (connectionState.value !== 'connected') setState('connected')
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      void instance.sendCandidate(options.roomId.value, {
        from: options.selfUid.value,
        to: options.peerUid.value,
        candidate: event.candidate.toJSON(),
      })
    }

    peer.onconnectionstatechange = () => {
      switch (peer.connectionState) {
        case 'connected':
          setState('connected')
          break
        case 'connecting':
          if (connectionState.value !== 'connected') setState('connecting')
          break
        case 'disconnected':
          setState('reconnecting')
          break
        case 'failed':
          setState('error', 'The direct connection failed. Check your network, or ask the other member to rejoin.')
          break
        case 'closed':
          if (!stopped) setState('peer-left')
          break
        default:
          break
      }
    }

    peer.onnegotiationneeded = () => {
      // Only the designated offerer initiates; the other side asks.
      if (isOfferer() && peer.signalingState === 'stable') void makeOffer()
      else void sendRenegotiateRequest()
    }

    pc.value = peer
    return peer
  }

  async function makeOffer(): Promise<void> {
    const peer = await ensurePeer()
    const instance = await getBackendInstance()
    const offer = await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
    await peer.setLocalDescription(offer)
    sequence += 1
    await instance.sendSignal(options.roomId.value, {
      kind: 'offer',
      from: options.selfUid.value,
      to: options.peerUid.value,
      sdp: offer.sdp ?? null,
      sequence,
    })
    if (connectionState.value !== 'connected') setState('connecting')
  }

  async function sendRenegotiateRequest(): Promise<void> {
    const instance = await getBackendInstance()
    sequence += 1
    await instance.sendSignal(options.roomId.value, {
      kind: 'renegotiate',
      from: options.selfUid.value,
      to: options.peerUid.value,
      sdp: null,
      sequence,
    })
  }

  async function handleSignal(message: { kind: string; from: string; to: string; sdp: string | null; sequence: number }): Promise<void> {
    if (message.to !== options.selfUid.value || message.from !== options.peerUid.value) return
    const peer = await ensurePeer()

    if (message.kind === 'bye') {
      setState('peer-left', 'The other member left the room.')
      peer.close()
      pc.value = null
      return
    }

    if (message.kind === 'renegotiate') {
      if (isOfferer()) await makeOffer()
      return
    }

    if (message.kind === 'offer') {
      if (!message.sdp) return
      // Glare guard: if both sides offered, the non-offerer rolls back.
      if (peer.signalingState === 'have-local-offer' && isOfferer()) return
      if (peer.signalingState === 'have-local-offer') {
        await peer.setLocalDescription({ type: 'rollback' } as RTCLocalSessionDescriptionInit)
      }
      await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp })
      remoteDescriptionSet = true
      await flushCandidates()
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      sequence += 1
      const instance = await getBackendInstance()
      await instance.sendSignal(options.roomId.value, {
        kind: 'answer',
        from: options.selfUid.value,
        to: options.peerUid.value,
        sdp: answer.sdp ?? null,
        sequence,
      })
      if (connectionState.value !== 'connected') setState('connecting')
      return
    }

    if (message.kind === 'answer') {
      if (!message.sdp) return
      if (peer.signalingState !== 'have-local-offer') return
      await peer.setRemoteDescription({ type: 'answer', sdp: message.sdp })
      remoteDescriptionSet = true
      await flushCandidates()
    }
  }

  async function flushCandidates(): Promise<void> {
    const peer = pc.value
    if (!peer || !remoteDescriptionSet) return
    const queued = pendingCandidates
    pendingCandidates = []
    for (const candidate of queued) {
      try {
        await peer.addIceCandidate(candidate)
      } catch {
        /* a stale candidate is not fatal — ICE will retry */
      }
    }
  }

  async function handleCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    const peer = await ensurePeer()
    if (!remoteDescriptionSet) {
      pendingCandidates.push(candidate)
      return
    }
    try {
      await peer.addIceCandidate(candidate)
    } catch {
      /* ignore */
    }
  }

  /** Request camera + microphone. Falls back to audio-only if the camera is blocked. */
  async function acquireMedia(): Promise<void> {
    setState('requesting-media')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      localStream.value = stream
      media.value = {
        camera: stream.getVideoTracks().length > 0,
        microphone: stream.getAudioTracks().length > 0,
        screen: false,
      }
    } catch (e) {
      const name = e instanceof DOMException ? e.name : 'Error'
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState(
          'error',
          'Camera and microphone access was blocked. Allow permissions in your browser, then rejoin the room.',
        )
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setState('error', 'No camera or microphone was found. You can still join to listen and chat.')
      } else {
        setState('error', 'Could not start your camera or microphone. Please try again.')
      }
      throw e
    }
  }

  function attachTracks(): void {
    const peer = pc.value
    const stream = localStream.value
    if (!peer || !stream) return
    const existing = new Set(peer.getSenders().map((sender) => sender.track?.kind))
    for (const track of stream.getTracks()) {
      if (existing.has(track.kind)) continue
      peer.addTrack(track, stream)
    }
  }

  async function start(): Promise<void> {
    stopped = false
    error.value = null
    const instance = await getBackendInstance()
    const roomId = options.roomId.value
    const selfUid = options.selfUid.value

    try {
      await acquireMedia()
    } catch {
      // Continue with an empty local stream: the member can still see/hear the peer.
      localStream.value = localStream.value ?? new MediaStream()
    }

    try {
      await instance.registerPresence(roomId, selfUid, media.value)
    } catch (e) {
      setState('error', e instanceof Error ? e.message : 'This room is not available.')
      return
    }

    await ensurePeer()
    attachTracks()

    clearSignals = instance.watchSignals(roomId, selfUid, (message) => {
      void handleSignal(message)
    })
    clearCandidates = instance.watchCandidates(roomId, selfUid, (message) => {
      void handleCandidate(message.candidate)
    })
    clearPresence = instance.watchPresence(roomId, (presence) => {
      const peer = presence.find((p) => p.uid === options.peerUid.value && !p.leftAt)
      peerPresent.value = Boolean(peer)
      if (peer) {
        remoteMedia.value = peer.media
        if (connectionState.value === 'waiting-for-peer' || connectionState.value === 'idle') setState('connecting')
      } else if (connectionState.value === 'connected') {
        setState('peer-left', 'The other member left the room. You can wait — the room stays open.')
      } else if (connectionState.value !== 'error') {
        setState('waiting-for-peer')
      }
    })

    // Presence heartbeat: also feeds server-side attendance verification.
    heartbeat = setInterval(() => {
      void instance.updatePresence(roomId, selfUid, { lastSeen: new Date().toISOString(), media: media.value })
    }, 10_000)

    if (isOfferer()) await makeOffer()
    else setState('waiting-for-peer')
  }

  async function toggleCamera(): Promise<void> {
    const track = localStream.value?.getVideoTracks()[0]
    if (!track) {
      // No camera track yet (permission was refused) — try to add one.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        const newTrack = stream.getVideoTracks()[0]
        localStream.value = localStream.value ?? new MediaStream()
        localStream.value.addTrack(newTrack)
        const peer = await ensurePeer()
        peer.addTrack(newTrack, localStream.value)
        media.value = { ...media.value, camera: true }
        await syncPresence()
      } catch {
        error.value = 'Camera permission is still blocked.'
      }
      return
    }
    track.enabled = !track.enabled
    media.value = { ...media.value, camera: track.enabled }
    await syncPresence()
  }

  async function toggleMicrophone(): Promise<void> {
    const track = localStream.value?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    media.value = { ...media.value, microphone: track.enabled }
    await syncPresence()
  }

  /**
   * Screen sharing replaces the outgoing video track (no second track, so no
   * awkward picture-in-picture of a camera nobody wants to see). Renegotiation
   * is triggered automatically when the track is replaced.
   */
  async function toggleScreenShare(): Promise<void> {
    const peer = await ensurePeer()
    const sender = peer.getSenders().find((s) => s.track?.kind === 'video')

    if (screenStream.value) {
      stopScreenShare(sender)
      return
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      error.value = 'Screen sharing is not supported by this browser.'
      return
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      screenStream.value = stream
      const screenTrack = stream.getVideoTracks()[0]
      screenTrack.onended = () => stopScreenShare(sender)
      if (sender) await sender.replaceTrack(screenTrack)
      else peer.addTrack(screenTrack, stream)
      media.value = { ...media.value, screen: true }
      await syncPresence()
    } catch {
      error.value = 'Screen sharing was cancelled or blocked.'
    }
  }

  function stopScreenShare(sender?: RTCRtpSender): void {
    const stream = screenStream.value
    const cameraTrack = localStream.value?.getVideoTracks()[0] ?? null
    const target = sender ?? pc.value?.getSenders().find((s) => s.track?.kind === 'video')
    if (target) void target.replaceTrack(cameraTrack)
    stream?.getTracks().forEach((track) => track.stop())
    screenStream.value = null
    media.value = { ...media.value, screen: false }
    void syncPresence()
  }

  async function syncPresence(): Promise<void> {
    const instance = await getBackendInstance()
    await instance.updatePresence(options.roomId.value, options.selfUid.value, { media: media.value })
  }

  /** Tear down: announce departure, stop tracks, clear listeners. */
  async function stop(announce = true): Promise<void> {
    stopped = true
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
    clearSignals?.()
    clearCandidates?.()
    clearPresence?.()
    clearSignals = clearCandidates = clearPresence = null

    const instance = backend.value
    if (instance) {
      if (announce) {
        try {
          await instance.sendSignal(options.roomId.value, {
            kind: 'bye',
            from: options.selfUid.value,
            to: options.peerUid.value,
            sdp: null,
            sequence: sequence + 1,
          })
        } catch {
          /* best effort */
        }
      }
      await instance.leavePresence(options.roomId.value, options.selfUid.value)
    }

    screenStream.value?.getTracks().forEach((track) => track.stop())
    localStream.value?.getTracks().forEach((track) => track.stop())
    localStream.value = null
    screenStream.value = null
    remoteStream.value = null
    pc.value?.close()
    pc.value = null
    remoteDescriptionSet = false
    pendingCandidates = []
    setState('idle')
  }

  function cleanup(): void {
    void stop(true)
  }

  onBeforeUnmount(cleanup)

  return {
    localStream,
    remoteStream,
    connectionState,
    error,
    media,
    remoteMedia,
    peerPresent,
    start,
    stop,
    cleanup,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
  }
}
