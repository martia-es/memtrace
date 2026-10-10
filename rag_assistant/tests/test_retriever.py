"""La recuperación se valida sin LLM ni red: cada FAQ debe ser localizable con una pregunta natural."""

import pytest

from app.knowledge.retriever import Bm25Retriever, load_entries, tokenize

ENTRIES = load_entries()
RETRIEVER = Bm25Retriever(ENTRIES)

# pregunta natural -> FAQ que debe salir la primera
QUESTIONS = [
    ("¿Cuánto pesa el equipaje de mano que puedo llevar?", "equipaje-mano"),
    ("How heavy can my carry-on be?", "equipaje-mano"),
    ("¿Cuántas maletas puedo facturar con la tarifa básica?", "equipaje-facturado"),
    ("Mi maleta no ha llegado, ¿qué hago?", "equipaje-perdido"),
    ("¿Puedo llevar mi bicicleta en el avión?", "equipaje-especial"),
    ("¿Cuándo se abre el check-in online?", "checkin-online"),
    ("¿A qué hora cierra el mostrador de facturación?", "checkin-mostrador"),
    ("¿Necesito visado o pasaporte para viajar?", "documentacion"),
    ("¿Cómo cambio la fecha de mi vuelo?", "cambio-vuelo"),
    ("Quiero cancelar mi vuelo y que me devuelvan el dinero", "cancelacion-reembolso"),
    ("Mi vuelo lleva más de 3 horas de retraso, ¿tengo compensación?", "vuelo-cancelado-retraso"),
    ("He perdido la conexión por un retraso", "perdida-conexion"),
    ("¿Qué son los Avios y cómo los gano?", "iberia-club"),
    ("¿Puedo canjear mis Avios por un vuelo?", "avios-canje"),
    ("¿Puede un niño de 8 años viajar solo?", "menores-solos"),
    ("Viajo con un bebé de 1 año, ¿qué necesito?", "bebes"),
    ("¿Puedo viajar con mi perro en cabina?", "mascotas"),
    ("Necesito una silla de ruedas en el aeropuerto", "asistencia-especial"),
    ("¿Cómo elijo asiento de ventanilla?", "seleccion-asiento"),
    ("No encuentro mi localizador de reserva", "gestionar-reserva"),
    ("¿Cómo puedo presentar una reclamación?", "contacto"),
]


def test_entries_are_complete_and_unique():
    assert len(ENTRIES) >= 20
    assert all(e.id and e.title and e.text for e in ENTRIES)


@pytest.mark.parametrize(("question", "expected"), QUESTIONS, ids=[q for q, _ in QUESTIONS])
def test_the_right_faq_comes_first(question, expected):
    hits = RETRIEVER.search(question, top_k=3)
    assert hits and hits[0].entry.id == expected, [h.entry.id for h in hits]


def test_off_topic_questions_find_nothing_relevant():
    from app.capabilities.faq import is_relevant

    for question in ("¿Qué tiempo hace en Madrid?", "Dame una receta de paella", "¿Quién ganó el Mundial de 2010?"):
        assert not [hit for hit in RETRIEVER.search(question) if is_relevant(hit)], question


def test_results_are_ranked_and_limited():
    hits = RETRIEVER.search("equipaje maleta peso", top_k=2)
    assert len(hits) == 2 and hits[0].score >= hits[1].score


def test_tokenize_folds_accents_stopwords_and_plurals():
    assert tokenize("¿Cuántas MALETAS pueden facturarse?") == ["maleta", "facturarse"]
