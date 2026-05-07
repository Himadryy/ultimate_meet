Ultimate Meet — Scaling Plan

Overview
- Objective: enable horizontal scaling of the signaling layer and provide clear SFU (mediasoup) integration hooks.

Architecture
- Signaling nodes are stateless with respect to cross-node coordination; room/participant authoritative state remains in-memory on the node that receives joins.
- Nodes coordinate via a pub/sub channel (Redis in production, in-memory fallback for single-node/dev).
- Relay events (offer/answer/ice) are published to the cluster when the target participant is not local; the node owning the target forwards the message to the participant.
- SFU (mediasoup) runs as separate service(s). Streamers are routed to an SFU instance with optional room-affinity (sticky) for better performance.

Room affinity and routing
- Use a mapping of room -> preferred SFU instance. Keep affinity in an external store (Redis) or use application-layer sticky routing.
- If a participant is routed to a different SFU, orchestrate cross-SFU forwarding via SFU interconnect or by re-negotiating streams.

Autoscaling
- Signaling nodes are horizontally scalable. Use Kubernetes or autoscaling groups keyed to CPU/network metrics.
- Redis should be a managed cluster for durability. Scale SFU pool independently based on publisher count and bandwidth.

Operational notes & costs
- Redis: small managed instance for pub/sub; cost depends on throughput and HA needs.
- SFU: highest cost (CPU and network). Benchmark per-concurrent-stream cost and autoscale accordingly. Consider turning on aggressive stream adaptation to reduce SFU load.

Next steps (implementation)
- Implement Redis-backed pub/sub with in-memory fallback (done).
- Add room affinity mapping and simple SFU placeholder integration hooks.
- Integrate health checks and observability for autoscaling triggers.
