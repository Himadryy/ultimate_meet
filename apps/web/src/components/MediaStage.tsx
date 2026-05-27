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
  localStreams: MediaStream[];
  remoteStreams: MediaStream[];
}

export function MediaStage({ role, localStreams, remoteStreams }: MediaStageProps) {
  const streams = role === "streamer" ? localStreams : remoteStreams;
  
  return (
    <section className="card">
      <h2>Live Stage</h2>
      <div className="media-grid">
        {streams.length === 0 ? (
          <p>{role === "streamer" ? "Allow camera/mic permission to publish stream." : "Waiting for streamer media."}</p>
        ) : (
          streams.map((stream, index) => (
            <MediaTile
              key={stream.id || index}
              title={role === "streamer" ? `Studio Preview ${index + 1}` : `Host Feed ${index + 1}`}
              stream={stream}
              muted={role === "streamer"}
              placeholder=""
            />
          ))
        )}
      </div>
    </section>
  );
}
