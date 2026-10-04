import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBackendForTesting } from '@/lib/backend'
import type { PeerPulseBackend } from '@/lib/backend/types'
import type { IceCandidateMessage, MediaState, RoomPresence, SignalingMessage } from '@shared/domain'
import { useWebRTC } from '@/composables/useWebRTC'

/**
 * The WebRTC negotiation logic, exercised without a browser.
 *
 * `useWebRTC` is the part of live sessions that decides *who offers*, when it is
 * safe to answer, how ICE candidates that arrive before the remote description
 * are held, and how a departure is announced. All of that is plain state
 * machine work on top of `RTCPeerConnection`, so it can be tested with a fake
 * peer — no media, no network, no two browsers — while the signalling path stays
 * the real code under test.
 *
 * What this file can and cannot prove: it proves the sequencing decisions, the
 * glare rule, the ICE queue, the state transitions and the teardown. It cannot
 * prove that a real browser connects, that TURN relays a NAT'd peer, or that
 * audio flows — those need two machines and `docs/webrtc-signaling.md` §12.
 */

/* ── a fake RTCPeerConnection good enough for the state machine ─────────────── */

interface FakeSender {
  track: FakeTrack | null
  replaceTrack(track: FakeTrack | null): Promise<void>
}

interface FakeTrack {
  kind: 'audio' | 'video'
  enabled: boolean
  stop(): void
  onended: (() => void) | null
}

class FakeMediaStream {
  tracks: FakeTrack[] = []

  constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks
  }

  getTracks(): FakeTrack[] {
    return this.tracks
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'video')
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio')
  }

  addTrack(track: FakeTrack): void {
    this.tracks.push(track)
  }
}

function fakeTrack(kind: 'audio' | 'video'): FakeTrack {
  return {
    kind,
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true
    },
    onended: null,
  } as FakeTrack & { stopped: boolean }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  config: RTCConfiguration
  signalingState: RTCSignalingState = 'stable'
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: { type: string; sdp?: string } | null = null
  remoteDescription: { type: string; sdp?: string } | null = null
  addedCandidates: RTCIceCandidateInit[] = []
  senders: FakeSender[] = []
  closed = false
  offersCreated = 0
  answersCreated = 0

  ontrack: ((event: { streams: FakeMediaStream[]; track?: FakeTrack }) => void) | null = null
  onicecandidate: ((event: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  onnegotiationneeded: (() => void) | null = null

  constructor(config: RTCConfiguration = {}) {
    this.config = config
    FakePeerConnection.instances.push(this)
  }

  async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
    this.offersCreated += 1
    return { type: 'offer', sdp: `offer-${this.offersCreated}` }
  }

  async createAnswer(): Promise<{ type: 'answer'; sdp: string }> {
    this.answersCreated += 1
    return { type: 'answer', sdp: `answer-${this.answersCreated}` }
  }

  async setLocalDescription(description: { type: string; sdp?: string }): Promise<void> {
    this.localDescription = description
    this.signalingState = description.type === 'rollback' ? 'stable' : 'have-local-offer'
  }

  async setRemoteDescription(description: { type: string; sdp?: string }): Promise<void> {
    this.remoteDescription = description
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedCandidates.push(candidate)
  }

  addTrack(track: FakeTrack): FakeSender {
    const sender: FakeSender = {
      track,
      replaced: [],
      async replaceTrack(next: FakeTrack | null) {
        sender.track = next
        ;(sender as unknown as { replaced: FakeTrack[] }).replaced.push(next as FakeTrack)
      },
    } as FakeSender
    this.senders.push(sender)
    return sender
  }

  getSenders(): FakeSender[] {
    return this.senders
  }

  close(): void {
    this.closed = true
    this.connectionState = 'closed'
    this.onconnectionstatechange?.()
  }

  /** Test helper: let ICE produce a candidate. */
  emitIceCandidate(candidate: RTCIceCandidateInit): void {
    this.onicecandidate?.({ candidate: { toJSON: () => candidate } })
  }

  /** Test helper: move the transport state the way a browser would. */
  setConnectionState(next: RTCPeerConnectionState): void {
    this.connectionState = next
    this.onconnectionstatechange?.()
  }

  /** Test helper: a remote track arrives. */
  emitRemoteTrack(stream: FakeMediaStream): void {
    this.ontrack?.({ streams: [stream] })
  }
}

/* ── a recording backend: the real signalling contract, no Firestore ────────── */

class RecordingBackend {
  signals: Array<Omit<SignalingMessage, 'id' | 'createdAt'>> = []
  candidates: Array<Omit<IceCandidateMessage, 'id' | 'createdAt'>> = []
  presence = new Map<string, Partial<RoomPresence>>()
  iceServers: RTCIceServer[] = [{ urls: 'stun:stun.peerpulse.test:3478' }]
  leavePresenceCalls = 0

  private signalWatchers: Array<(message: SignalingMessage) => void> = []
  private candidateWatchers: Array<(message: IceCandidateMessage) => void> = []
  private presenceWatchers: Array<(presence: RoomPresence[]) => void> = []

  async getIceServers(): Promise<RTCIceServer[]> {
    return this.iceServers
  }

  async registerPresence(_roomId: string, uid: string, media: MediaState): Promise<RoomPresence> {
    const now = new Date().toISOString()
    const entry: RoomPresence = {
      uid,
      displayName: uid,
      avatarSeed: uid,
      role: 'learner',
      joinedAt: now,
      lastSeen: now,
      leftAt: null,
      media,
    }
    this.presence.set(uid, entry)
    this.emitPresence()
    return entry
  }

  async updatePresence(_roomId: string, uid: string, patch: Partial<RoomPresence>): Promise<void> {
    this.presence.set(uid, { ...(this.presence.get(uid) ?? { uid }), ...patch })
    this.emitPresence()
  }

  async leavePresence(): Promise<void> {
    this.leavePresenceCalls += 1
    this.presence.clear()
    this.emitPresence()
  }

  async listPresence(): Promise<RoomPresence[]> {
    return [...this.presence.values()] as RoomPresence[]
  }

  watchPresence(_roomId: string, cb: (presence: RoomPresence[]) => void): () => void {
    this.presenceWatchers.push(cb)
    cb([...this.presence.values()] as RoomPresence[])
    return () => {
      this.presenceWatchers = this.presenceWatchers.filter((w) => w !== cb)
    }
  }

  async sendSignal(_roomId: string, message: Omit<SignalingMessage, 'id' | 'createdAt'>): Promise<void> {
    this.signals.push(message)
  }

  watchSignals(_roomId: string, _uid: string, cb: (message: SignalingMessage) => void): () => void {
    this.signalWatchers.push(cb)
    return () => {
      this.signalWatchers = this.signalWatchers.filter((w) => w !== cb)
    }
  }

  async sendCandidate(_roomId: string, message: Omit<IceCandidateMessage, 'id' | 'createdAt'>): Promise<void> {
    this.candidates.push(message)
  }

  watchCandidates(_roomId: string, _uid: string, cb: (message: IceCandidateMessage) => void): () => void {
    this.candidateWatchers.push(cb)
    return () => {
      this.candidateWatchers = this.candidateWatchers.filter((w) => w !== cb)
    }
  }

  /* test helpers */

  receiveSignal(message: Omit<SignalingMessage, 'id' | 'createdAt'>): void {
    for (const watcher of this.signalWatchers) watcher({ ...message, id: 'sig', createdAt: new Date().toISOString() })
  }

  receiveCandidate(candidate: RTCIceCandidateInit, from: string): void {
    const message = { from, to: 'x', candidate }
    for (const watcher of this.candidateWatchers) {
      watcher({ ...message, id: 'cand', createdAt: new Date().toISOString() } as IceCandidateMessage)
    }
  }

  private emitPresence(): void {
    for (const watcher of this.presenceWatchers) watcher([...this.presence.values()] as RoomPresence[])
  }
}

const LEARNER = 'demo_sam'
const TEACHER = 'demo_lena'

let backend: RecordingBackend
/** Any inbound watcher is asynchronous by nature; give microtasks a turn. */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

function session(selfUid: string, peerUid: string, canPublish = true) {
  return useWebRTC({
    roomId: ref('room_bk_test'),
    selfUid: ref(selfUid),
    peerUid: ref(peerUid),
    canPublish: ref(canPublish),
  })
}

beforeEach(() => {
  FakePeerConnection.instances = []
  backend = new RecordingBackend()
  setBackendForTesting(backend as unknown as PeerPulseBackend)

  vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
  vi.stubGlobal('MediaStream', FakeMediaStream)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => new FakeMediaStream([fakeTrack('video'), fakeTrack('audio')])),
      getDisplayMedia: vi.fn(async () => new FakeMediaStream([fakeTrack('video')])),
    },
  })
})

afterEach(() => {
  setBackendForTesting(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useWebRTC: who offers', () => {
  it('has the lower uid offer, and the other side wait', async () => {
    // 'demo_lena' sorts below 'demo_sam', so the teacher offers here. The rule is
    // "lower sorted uid offers", which both participants compute independently —
    // no negotiation about who negotiates.
    expect(TEACHER < LEARNER).toBe(true)

    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()

    const [peer] = FakePeerConnection.instances
    expect(peer.offersCreated).toBe(1)
    expect(backend.signals[0]).toMatchObject({ kind: 'offer', from: TEACHER, to: LEARNER })
    expect(teacher.connectionState.value).toBe('connecting')

    // The learner, whose uid sorts higher, must not offer.
    const learner = session(LEARNER, TEACHER)
    await learner.start()
    await settle()
    expect(FakePeerConnection.instances[1].offersCreated).toBe(0)
    expect(backend.signals.filter((signal) => signal.kind === 'offer')).toHaveLength(1)
    expect(learner.connectionState.value).toBe('waiting-for-peer')

    await teacher.stop(false)
    await learner.stop(false)
  })

  it('asks the offerer to renegotiate instead of offering from the wrong side', async () => {
    // The learner (higher uid) is not the offerer: it must ask.
    const learner = session(LEARNER, TEACHER)
    await learner.start()
    await settle()

    FakePeerConnection.instances[0].onnegotiationneeded?.()
    await settle()

    expect(backend.signals.some((signal) => signal.kind === 'renegotiate')).toBe(true)
    expect(FakePeerConnection.instances[0].offersCreated).toBe(0)

    // The offerer (lower uid) turns that request into a real offer.
    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()
    FakePeerConnection.instances[1].offersCreated = 0
    backend.receiveSignal({ kind: 'renegotiate', from: LEARNER, to: TEACHER, sdp: null, sequence: 2 })
    await settle()
    expect(FakePeerConnection.instances[1].offersCreated).toBe(1)

    await teacher.stop(false)
    await learner.stop(false)
  })
})

describe('useWebRTC: answering and ICE', () => {
  it('answers an offer and sets the remote description', async () => {
    const learner = session(LEARNER, TEACHER)
    await learner.start()
    await settle()

    backend.receiveSignal({ kind: 'offer', from: TEACHER, to: LEARNER, sdp: 'remote-offer', sequence: 1 })
    await settle()

    const peer = FakePeerConnection.instances[0]
    expect(peer.remoteDescription).toMatchObject({ type: 'offer', sdp: 'remote-offer' })
    expect(peer.answersCreated).toBe(1)
    expect(backend.signals.some((signal) => signal.kind === 'answer' && signal.sdp === 'answer-1')).toBe(true)

    await learner.stop(false)
  })

  it('holds ICE candidates that arrive before the remote description, then releases them', async () => {
    const learner = session(LEARNER, TEACHER)
    await learner.start()
    await settle()
    const peer = FakePeerConnection.instances[0]

    backend.receiveCandidate({ candidate: 'early-1' }, TEACHER)
    backend.receiveCandidate({ candidate: 'early-2' }, TEACHER)
    await settle()
    expect(peer.addedCandidates).toHaveLength(0)

    backend.receiveSignal({ kind: 'offer', from: TEACHER, to: LEARNER, sdp: 'remote-offer', sequence: 1 })
    await settle()
    expect(peer.addedCandidates.map((c) => c.candidate)).toEqual(['early-1', 'early-2'])

    backend.receiveCandidate({ candidate: 'late-1' }, TEACHER)
    await settle()
    expect(peer.addedCandidates.map((c) => c.candidate)).toEqual(['early-1', 'early-2', 'late-1'])

    await learner.stop(false)
  })

  it('sends its own ICE candidates to the peer, and ignores a candidate from anyone else', async () => {
    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()

    FakePeerConnection.instances[0].emitIceCandidate({ candidate: 'mine' })
    await settle()
    expect(backend.candidates).toHaveLength(1)
    expect(backend.candidates[0]).toMatchObject({ from: TEACHER, to: LEARNER })

    // A message for another room pair, or from a third party, is filtered out.
    backend.receiveSignal({ kind: 'offer', from: 'demo_mei', to: TEACHER, sdp: 'not-yours', sequence: 1 })
    await settle()
    expect(FakePeerConnection.instances[0].remoteDescription).toBeNull()

    await teacher.stop(false)
  })
})

describe('useWebRTC: glare and departures', () => {
  it('ignores an offer that crosses its own when it is the designated offerer', async () => {
    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()
    const peer = FakePeerConnection.instances[0]
    expect(peer.signalingState).toBe('have-local-offer')

    backend.receiveSignal({ kind: 'offer', from: LEARNER, to: TEACHER, sdp: 'colliding-offer', sequence: 1 })
    await settle()

    // The offerer keeps its own offer; it neither rolls back nor answers.
    expect(peer.remoteDescription).toBeNull()
    expect(peer.answersCreated).toBe(0)
    expect(peer.offersCreated).toBe(1)

    await teacher.stop(false)
  })

  it('rolls back and answers when the non-offerer receives an offer mid-negotiation', async () => {
    const learner = session(LEARNER, TEACHER)
    await learner.start()
    await settle()
    const peer = FakePeerConnection.instances[0]

    // The learner asked to renegotiate; the offerer's offer arrives while a local
    // offer of its own is still in flight.
    await peer.setLocalDescription({ type: 'offer', sdp: 'stale-local' })
    expect(peer.signalingState).toBe('have-local-offer')

    backend.receiveSignal({ kind: 'offer', from: TEACHER, to: LEARNER, sdp: 'authoritative', sequence: 2 })
    await settle()

    expect(peer.remoteDescription).toMatchObject({ type: 'offer', sdp: 'authoritative' })
    expect(peer.answersCreated).toBe(1)

    await learner.stop(false)
  })

  it('treats a bye as the peer leaving and closes the connection', async () => {
    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()

    backend.receiveSignal({ kind: 'bye', from: LEARNER, to: TEACHER, sdp: null, sequence: 5 })
    await settle()

    expect(teacher.connectionState.value).toBe('peer-left')
    expect(FakePeerConnection.instances[0].closed).toBe(true)

    await teacher.stop(false)
  })

  it('announces its own departure and clears its presence on stop', async () => {
    const learner = session(LEARNER, TEACHER)
    await learner.start()
    await settle()
    backend.signals.length = 0

    await learner.stop()

    expect(backend.signals.at(-1)).toMatchObject({ kind: 'bye', from: LEARNER })
    expect(backend.leavePresenceCalls).toBe(1)
    expect(FakePeerConnection.instances[0].closed).toBe(true)
    expect(learner.connectionState.value).toBe('idle')
    expect(learner.localStream.value).toBeNull()
  })
})

describe('useWebRTC: media and state', () => {
  it('reports the connection as live when the first remote track arrives', async () => {
    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()

    FakePeerConnection.instances[0].emitRemoteTrack(new FakeMediaStream([fakeTrack('video'), fakeTrack('audio')]))

    expect(teacher.connectionState.value).toBe('connected')
    expect(teacher.remoteMedia.value).toMatchObject({ camera: true, microphone: true })
    expect(teacher.remoteStream.value).not.toBeNull()

    await teacher.stop(false)
  })

  it('explains a blocked camera instead of failing silently, and still joins', async () => {
    const blocked = new DOMException('denied', 'NotAllowedError')
    ;(navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(blocked)

    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()

    // The explanation survives the connection moving on to 'connecting' — it used
    // to be written into `error` and wiped by the very next state transition, so
    // the member joined with no camera, no microphone and no idea why.
    expect(teacher.mediaWarning.value).toMatch(/permissions/i)
    expect(teacher.connectionState.value).toBe('connecting')
    expect(teacher.media.value).toMatchObject({ camera: false, microphone: false })

    // The session still negotiates: they can watch and listen.
    expect(backend.signals.some((signal) => signal.kind === 'offer')).toBe(true)

    await teacher.stop(false)
  })

  it('clears the warning once a camera is turned on later', async () => {
    const blocked = new DOMException('denied', 'NotAllowedError')
    ;(navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(blocked)

    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()
    expect(teacher.mediaWarning.value).toBeTruthy()

    await teacher.toggleCamera()
    expect(teacher.mediaWarning.value).toBeNull()
    expect(teacher.media.value.camera).toBe(true)

    await teacher.stop(false)
  })

  it('toggles the camera and the microphone through presence, so the peer sees it', async () => {
    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()

    await teacher.toggleCamera()
    expect(teacher.media.value.camera).toBe(false)
    expect(backend.presence.get(TEACHER)?.media).toMatchObject({ camera: false })

    await teacher.toggleMicrophone()
    expect(teacher.media.value.microphone).toBe(false)
    expect(backend.presence.get(TEACHER)?.media).toMatchObject({ microphone: false })

    await teacher.stop(false)
  })

  it('replaces the outgoing video track for screen sharing, and restores the camera', async () => {
    const teacher = session(TEACHER, LEARNER)
    await teacher.start()
    await settle()
    const peer = FakePeerConnection.instances[0]
    const sender = peer.getSenders().find((s) => s.track?.kind === 'video')!
    expect(sender).toBeDefined()

    await teacher.toggleScreenShare()
    expect(teacher.media.value.screen).toBe(true)
    expect(sender.track?.kind).toBe('video')
    expect(backend.presence.get(TEACHER)?.media).toMatchObject({ screen: true })

    await teacher.toggleScreenShare()
    expect(teacher.media.value.screen).toBe(false)
    expect(backend.presence.get(TEACHER)?.media).toMatchObject({ screen: false })

    await teacher.stop(false)
  })

  it('refuses to negotiate media in a finished room', async () => {
    // `canPublish` is false for a completed session. The option used to be
    // declared and never read, so a caller that reached start() would have opened
    // a camera in a room whose session had already been settled.
    const spectator = session(TEACHER, LEARNER, false)
    await spectator.start()
    await settle()

    expect(spectator.error.value).toMatch(/read-only/i)
    expect(spectator.connectionState.value).toBe('error')
    // No camera prompt, no peer connection, no signalling.
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(FakePeerConnection.instances).toHaveLength(0)
    expect(backend.signals).toHaveLength(0)

    await spectator.stop(false)
  })
})
