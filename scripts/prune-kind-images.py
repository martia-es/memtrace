#!/usr/bin/env python3
"""Borra del nodo de kind las imágenes que el clúster ya no necesita.

Cada `kind load` (make images, make api, make dashboard...) añade la imagen nueva y deja la versión anterior sin etiqueta dentro
del nodo, que nunca la borra: con el tiempo son decenas de GB (en un clúster de desarrollo llegaron a ser 46 GB, el 90 % versiones
viejas) y el disco de la máquina de contenedores se llena.

Se conserva una imagen si:
  - la referencia algún workload del clúster (Pod, Deployment, StatefulSet, DaemonSet, Job o CronJob, de cualquier namespace). Eso
    protege las imágenes de los CronJob que ahora no corren (model-pricing, model-quality, topic-extraction), que `crictl rmi --prune`
    borraría;
  - la usa algún contenedor en marcha;
  - es la imagen `pause` del sandbox de Kubernetes, que no aparece en ningún manifiesto.
Todo lo demás se borra. Si la misma imagen tiene varios nombres, se mira cada uno: basta con que uno esté referenciado.

Seguridad: si el namespace de MemTrace no tiene ningún Deployment (clúster recién creado, antes de `kubectl apply`) no hace nada, porque
entonces ningún manifiesto referencia todavía las imágenes que acabas de cargar.

Por qué `ctr` y no `crictl rmi`: las imágenes cargadas con `kind load` se guardan en containerd con un nombre sin dominio
(`import-2026-09-28@sha256:...`), pero `crictl rmi` intenta borrar `docker.io/library/import-...@sha256:...`: dice «Deleted» y no borra
nada, tantas veces como se repita. Hay que borrar el registro por su nombre real con `ctr -n k8s.io images rm`.

Uso: python3 scripts/prune-kind-images.py [--cluster memtrace-cluster] [--namespace memtrace] [--dry-run]
Variables: CLUSTER, NS, CONTAINER_CLI (docker o podman; por defecto el que encuentre).
"""
import argparse, json, os, shutil, subprocess, sys

KINDS = "pods,deployments,statefulsets,daemonsets,jobs,cronjobs"


def run(cmd, check=True):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f"FALLO ejecutando {' '.join(cmd[:4])}...: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout


def normalise(name):
    """`docker.io/library/busybox:1.36`, `docker.io/busybox:1.36` y `busybox:1.36` son la misma imagen."""
    for prefix in ("docker.io/", "library/"):
        if name.startswith(prefix):
            name = name[len(prefix):]
    return name


def pod_specs(item):
    spec = item.get("spec", {})
    if item["kind"] == "Pod":
        yield spec
        for c in item.get("status", {}).get("containerStatuses", []) + item.get("status", {}).get("initContainerStatuses", []):
            yield {"containers": [{"image": c.get("image", "")}]}
    elif item["kind"] == "CronJob":
        yield spec.get("jobTemplate", {}).get("spec", {}).get("template", {}).get("spec", {})
    else:
        yield spec.get("template", {}).get("spec", {})


def referenced_images(kubectl):
    data = json.loads(run([*kubectl, "get", KINDS, "-A", "-o", "json"]))
    names = set()
    for item in data["items"]:
        for spec in pod_specs(item):
            for c in spec.get("containers", []) + spec.get("initContainers", []) + spec.get("ephemeralContainers", []):
                if c.get("image"):
                    names.add(normalise(c["image"]))
    return names


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cluster", default=os.environ.get("CLUSTER", "memtrace-cluster"))
    ap.add_argument("--namespace", default=os.environ.get("NS", "memtrace"))
    ap.add_argument("--dry-run", action="store_true", help="solo muestra qué se borraría")
    a = ap.parse_args()

    cli = os.environ.get("CONTAINER_CLI") or next((c for c in ("docker", "podman") if shutil.which(c)), None)
    if not cli:
        sys.exit("Falta docker o podman")
    node = f"{a.cluster}-control-plane"
    if node not in run([cli, "ps", "--format", "{{.Names}}"]).split():
        print(f"El nodo {node} no está en marcha: nada que limpiar")
        return
    kubectl = ["kubectl", "--context", f"kind-{a.cluster}"]
    if not run([*kubectl, "-n", a.namespace, "get", "deployments", "-o", "name"], check=False).strip():
        print(f"Nada desplegado todavía en {a.namespace}: no se borra nada (las imágenes recién cargadas aún no las referencia ningún manifiesto)")
        return

    crictl = [cli, "exec", node, "crictl"]
    wanted = referenced_images(kubectl)
    images = json.loads(run([*crictl, "images", "-o", "json"]))["images"]
    # solo contenedores vivos: uno parado (el pod que se acaba de sustituir, un Job terminado) no necesita que su imagen siga en el nodo
    used = {c["image"]["image"] for c in json.loads(run([*crictl, "ps", "-a", "-o", "json"]))["containers"] if c.get("state") in ("CONTAINER_RUNNING", "CONTAINER_CREATED")}

    ctr = [cli, "exec", node, "ctr", "-n", "k8s.io"]
    stored = set(run([*ctr, "images", "ls", "-q"]).split())

    def names_of(img):
        """Nombres reales de containerd (ver arriba) de una imagen de CRI: etiquetas, referencias por digest y el id."""
        found = set()
        for n in [*img.get("repoTags", []), *img.get("repoDigests", []), img["id"]]:
            for candidate in (n, n.removeprefix("docker.io/library/"), n.removeprefix("docker.io/")):
                if candidate in stored:
                    found.add(candidate)
        return found

    # CRI conserva un listado desfasado tras un `ctr images rm`: lo que containerd ya no tiene no cuenta
    images = [img for img in images if names_of(img)]

    drop, keep_size = [], 0
    for img in images:
        names = {normalise(n) for n in img.get("repoTags", [])} | {normalise(n) for n in img.get("repoDigests", [])}
        protected = (
            img["id"] in used
            or bool(names & wanted)
            or any("pause" in n for n in names)
            or any(w.split("@")[0] in names for w in wanted if "@" in w)
        )
        size = int(img.get("size", 0))
        if protected:
            keep_size += size
        else:
            drop.append((size, img))

    total = sum(s for s, _ in drop)
    print(f"{len(images)} imágenes en el nodo; se conservan {len(images) - len(drop)} ({human(keep_size)}) y sobran {len(drop)} ({human(total)} sumando tamaños; las capas compartidas se liberan una sola vez)")
    for size, img in sorted(drop, key=lambda x: -x[0])[:8]:
        label = (img.get("repoTags") or img.get("repoDigests") or ["<sin nombre>"])[0]
        print(f"  {human(size):>9}  {label[:90]}")
    if a.dry_run or not drop:
        if a.dry_run:
            print("(--dry-run: no se ha borrado nada)")
        return

    free_before = int(run([cli, "exec", node, "sh", "-c", "df -Pk /var/lib/containerd | tail -1 | tr -s ' ' | cut -d' ' -f4"]).strip() or 0) * 1024
    names = sorted(set().union(*(names_of(img) for _, img in drop)))
    removed = 0
    for i in range(0, len(names), 50):
        r = subprocess.run([*ctr, "images", "rm", *names[i:i + 50]], capture_output=True, text=True)
        removed += len([l for l in r.stdout.split("\n") if l.strip()])
    # containerd recoge las capas huérfanas en segundo plano: se espera un momento a que termine para medir
    import time
    time.sleep(8)
    free_after = int(run([cli, "exec", node, "sh", "-c", "df -Pk /var/lib/containerd | tail -1 | tr -s ' ' | cut -d' ' -f4"]).strip() or 0) * 1024
    left = len(run([*ctr, "images", "ls", "-q"]).split())
    print(f"Borrados {removed} registros de imagen; quedan {left} en el nodo. Espacio liberado en su disco: {human(max(free_after - free_before, 0))}")

if __name__ == "__main__":
    main()
