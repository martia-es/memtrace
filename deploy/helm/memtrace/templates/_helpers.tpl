{{- /* repository:tag de una imagen de .Values.images */ -}}
{{- define "memtrace.image" -}}
{{ .repository }}:{{ .tag }}
{{- end }}

{{- /* Valor de un secreto: el que das; si no, el que ya existe en el clúster; si no, uno al azar. */ -}}
{{- define "memtrace.secretValue" -}}
{{- $given := .given -}}
{{- if $given -}}
{{- $given -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" .ctx.Release.Namespace .secret -}}
{{- if and $existing $existing.data (hasKey $existing.data .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- else -}}
{{- randAlphaNum 32 -}}
{{- end -}}
{{- end -}}
{{- end }}
