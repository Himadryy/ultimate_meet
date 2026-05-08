import type { ParticipantInfo } from "@ultimate-meet/shared";

interface ParticipantsListProps {
  participants: ParticipantInfo[];
}

export function ParticipantsList({ participants }: ParticipantsListProps) {
  return (
    <section className="card">
      <h2>Circle Members ({participants.length})</h2>
      {participants.length === 0 ? (
        <p>No participants joined yet.</p>
      ) : (
        <ul className="participant-list">
          {participants.map((participant) => (
            <li key={participant.id}>
              <strong>{participant.id}</strong>
              <span className={`participant-chip participant-chip-${participant.role}`}>{participant.role}</span>
              {participant.role === "viewer" && (
                <span className="participant-meta">
                  talkback {participant.talkbackEnabled ? "on" : "off"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
