-- Quién puede anotar en una cola (ADR-051): lista explícita de personas por cola, en lugar de "cualquier
-- miembro del experimento". Las colas anteriores conservan su comportamiento: se les asigna como revisores a
-- quienes eran miembros del experimento y a quienes ya habían reclamado algún item.
CREATE TABLE IF NOT EXISTS annotation_queue_reviewers (
    queue_id UUID NOT NULL REFERENCES annotation_queues(id) ON DELETE CASCADE,
    user_id  UUID NOT NULL REFERENCES users(id),
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (queue_id, user_id)
);

INSERT INTO annotation_queue_reviewers (queue_id, user_id)
SELECT q.id, m.user_id
  FROM annotation_queues q
  JOIN experiment_memberships m ON m.experiment_id = q.experiment_id
ON CONFLICT DO NOTHING;

INSERT INTO annotation_queue_reviewers (queue_id, user_id)
SELECT DISTINCT i.queue_id, c.user_id
  FROM annotation_queue_claims c
  JOIN annotation_queue_items i ON i.id = c.queue_item_id
ON CONFLICT DO NOTHING;
