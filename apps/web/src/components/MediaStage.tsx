import { useEffect, useRef } from "react";
import type { ParticipantRole } from "@ultimate-meet/shared";

interface MediaTileProps {
  title: string;
  stream: MediaStream | null;
  muted: boolean;
  placeholder: string;
}

function MediaTile({ title, stream, muted, placeholder }: MediaTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="media-tile">
      <h3>{title}</h3>
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted={muted} controls={!muted} />
      ) : (
        <p>{placeholder}</p>
      )}
    </div>
  );
}

interface MediaStageProps {
  role: ParticipantRole;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

export function MediaStage({ role, localStream, remoteStream }: MediaStageProps) {
  return (
    <section className="card">
      <h2>Live Stream</h2>
      <div className="media-grid">
        {role === "streamer" ? (
          <MediaTile
            title="Local preview"
            stream={localStream}
            muted
            placeholder="Allow camera/mic permission to publish stream."
          />
        ) : (
          <MediaTile
            title="Streamer feed"
            stream={remoteStream}
            muted={false}
            placeholder="Waiting for streamer media."
          />
        )}
      </div>
    </section>
  );
}
