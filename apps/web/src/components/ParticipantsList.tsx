import type { ParticipantInfo } from "@ultimate-meet/shared";

interface ParticipantsListProps {
  participants: ParticipantInfo[];
}

export function ParticipantsList({ participants }: ParticipantsListProps) {
  return (
    <section className="card">
      <h2>Participants</h2>
      {participants.length === 0 ? (
        <p>No participants joined yet.</p>
      ) : (
        <ul className="participant-list">
          {participants.map((participant) => (
            <li key={participant.id}>
              <strong>{participant.id}</strong> ({participant.role})
              {participant.role === "viewer" ? ` · talkback ${participant.talkbackEnabled ? "on" : "off"}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
