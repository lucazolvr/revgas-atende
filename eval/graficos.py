"""
Gera as figuras do relatório a partir de eval/resultados/*.json:
    python eval/graficos.py
Saída: docs/relatorio/avaliacao-ia/figuras/*.png (fundo claro, para impressão).
Paleta validada (dataviz/validate_palette, modo claro, CVD ok): menu = azul, IA = laranja RevGás.
"""
import glob
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

MENU = "#3A75B5"
IA = "#E8571C"
TINTA = "#1F2328"
TINTA_2 = "#59636E"
GRADE = "#E6E8EB"
FUNDO = "#FFFFFF"
SAIDA = "docs/relatorio/avaliacao-ia/figuras"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 10,
    "axes.edgecolor": GRADE,
    "axes.labelcolor": TINTA_2,
    "axes.titleweight": "bold",
    "axes.titlesize": 12,
    "axes.titlecolor": TINTA,
    "axes.titlelocation": "left",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "xtick.color": TINTA_2,
    "ytick.color": TINTA_2,
    "figure.facecolor": FUNDO,
    "axes.facecolor": FUNDO,
    "savefig.dpi": 200,
    "savefig.bbox": "tight",
})


def ultimo(prefixo):
    arquivos = sorted(glob.glob(f"eval/resultados/{prefixo}-*.json"))
    if not arquivos:
        raise SystemExit(f"rode antes: npm run eval:{'ia' if prefixo == 'ia' else 'experimento'}")
    with open(arquivos[-1], encoding="utf-8") as f:
        return json.load(f)


def pct(x):
    return f"{x * 100:.0f}%".replace(".", ",")


def grade_x(ax):
    ax.grid(axis="x", color=GRADE, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0)


def salvar(fig, nome):
    os.makedirs(SAIDA, exist_ok=True)
    fig.savefig(f"{SAIDA}/{nome}.png")
    plt.close(fig)
    print(f"ok {SAIDA}/{nome}.png")


def fig_intencoes(ia):
    itens = [(k, v) for k, v in ia["porIntencao"].items() if v["total"]]
    itens.sort(key=lambda kv: kv[1]["acertos"] / kv[1]["total"])
    rotulos = [k.replace("_", " ") for k, _ in itens]
    valores = [v["acertos"] / v["total"] for _, v in itens]
    fig, ax = plt.subplots(figsize=(7, 0.42 * len(itens) + 1.2))
    ax.barh(rotulos, valores, color=IA, height=0.6)
    for i, (k, v) in enumerate(itens):
        ax.text(valores[i] + 0.01, i, f"{pct(valores[i])}  ({v['acertos']}/{v['total']})", va="center", color=TINTA, fontsize=9)
    ax.set_xlim(0, 1.18)
    ax.xaxis.set_major_formatter(lambda x, _: pct(x))
    ax.set_title(f"Acurácia por intenção — geral {pct(ia['acuraciaIntencao'])}")
    grade_x(ax)
    salvar(fig, "1-acuracia-intencao")


def fig_entidades(ia):
    campos = [(c, k) for c, k in ia["porCampo"].items() if k["vp"] + k["fn"] > 0]

    def f1(k):
        p = k["vp"] / (k["vp"] + k["fp"]) if k["vp"] + k["fp"] else 0
        r = k["vp"] / (k["vp"] + k["fn"]) if k["vp"] + k["fn"] else 0
        return 2 * p * r / (p + r) if p + r else 0

    campos.sort(key=lambda ck: f1(ck[1]))
    fig, ax = plt.subplots(figsize=(7, 0.42 * len(campos) + 1.2))
    valores = [f1(k) for _, k in campos]
    ax.barh([c.replace("endereco.", "endereço: ") for c, _ in campos], valores, color=IA, height=0.6)
    for i, (_, k) in enumerate(campos):
        ax.text(valores[i] + 0.01, i, f"{pct(valores[i])}  (n={k['vp'] + k['fn']})", va="center", color=TINTA, fontsize=9)
    ax.set_xlim(0, 1.18)
    ax.xaxis.set_major_formatter(lambda x, _: pct(x))
    ax.set_title("Extração de dados do pedido — F1 por campo")
    grade_x(ax)
    salvar(fig, "2-f1-entidades")


def fig_confusao(ia):
    intencoes = [k for k, v in ia["porIntencao"].items() if v["total"]]
    todas = intencoes + ["sem resposta"]
    matriz = [[0] * len(todas) for _ in intencoes]
    for r in ia["resultados"]:
        obtido = r["obtido"]["intencao"] if r["obtido"] else "sem resposta"
        if obtido not in todas:
            continue
        matriz[intencoes.index(r["esperado"]["intencao"])][todas.index(obtido)] += 1
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.imshow(matriz, cmap="Oranges", vmin=0)
    for i, linha in enumerate(matriz):
        for j, v in enumerate(linha):
            if v:
                ax.text(j, i, v, ha="center", va="center", color="white" if v > max(map(max, matriz)) * 0.6 else TINTA, fontsize=9)
    ax.set_xticks(range(len(todas)), [t.replace("_", " ") for t in todas], rotation=40, ha="right")
    ax.set_yticks(range(len(intencoes)), [t.replace("_", " ") for t in intencoes])
    ax.set_xlabel("Intenção identificada pela IA")
    ax.set_ylabel("Intenção esperada (rótulo)")
    ax.set_title("Matriz de confusão das intenções")
    for s in ax.spines.values():
        s.set_visible(False)
    ax.tick_params(length=0)
    salvar(fig, "3-matriz-confusao")


def fig_latencia(ia):
    lat = [x / 1000 for x in ia["latencias"]]
    fig, ax = plt.subplots(figsize=(7, 3.2))
    ax.hist(lat, bins=15, color=IA, edgecolor=FUNDO, linewidth=2)
    lat_ord = sorted(lat)
    mediana = lat_ord[len(lat_ord) // 2]
    ax.axvline(mediana, color=TINTA, linewidth=1.5, linestyle="--")
    ax.text(mediana, ax.get_ylim()[1] * 0.95, f"  mediana {mediana:.1f} s".replace(".", ","), color=TINTA, va="top", fontsize=9)
    ax.set_xlabel("segundos por mensagem")
    ax.set_ylabel("mensagens")
    ax.set_title("Tempo de resposta da IA (Gemini)")
    ax.grid(axis="y", color=GRADE, linewidth=0.8)
    ax.set_axisbelow(True)
    salvar(fig, "4-latencia-ia")


def fig_mensagens_por_perfil(exp):
    res = exp["resultados"]
    perfis = sorted({r["perfil"] for r in res})
    menu = {r["perfil"]: r["mensagens"] for r in res if r["modo"] == "menu"}
    ia = {r["perfil"]: r for r in res if r["modo"] == "ia"}
    ordem = sorted(perfis, key=lambda p: ia[p]["mensagens"], reverse=True)
    fig, ax = plt.subplots(figsize=(7, 0.32 * len(ordem) + 1.4))
    for i, p in enumerate(ordem):
        ax.plot([ia[p]["mensagens"], menu[p]], [i, i], color=GRADE, linewidth=2, zorder=1)
    ax.scatter([menu[p] for p in ordem], range(len(ordem)), color=MENU, s=55, zorder=2, label="Menu numerado", edgecolor=FUNDO, linewidth=2)
    ax.scatter([ia[p]["mensagens"] for p in ordem], range(len(ordem)), color=IA, s=55, zorder=3, label="Com IA", edgecolor=FUNDO, linewidth=2,
               marker="D")
    for i, p in enumerate(ordem):
        if not ia[p]["correto"]:
            ax.text(ia[p]["mensagens"] - 0.4, i, "✗", color=TINTA, ha="right", va="center", fontsize=9)
    ax.set_yticks(range(len(ordem)), [f"perfil {p}" for p in ordem])
    ax.set_xlabel("mensagens enviadas pelo cliente até concluir", labelpad=2)
    s = exp["resumo"]
    pv = s["wilcoxonMensagens"]["p"]
    ax.set_title(f"Mensagens por pedido — Wilcoxon p {'< 0,001' if pv < 0.001 else '= ' + f'{pv:.3f}'.replace('.', ',')}")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.07), ncol=2, frameon=False)
    ax.set_xlim(0.5, max(menu.values()) + 1)
    grade_x(ax)
    salvar(fig, "5-mensagens-por-perfil")


def fig_resumo_experimento(exp):
    s = exp["resumo"]
    metricas = [("Concluídos", "concluiram"), ("Corretos", "corretos"), ("Corrigiram\nno resumo", "comCorrecao"), ("Transferidos", "transferidos")]
    n = s["menu"]["n"]
    fig, ax = plt.subplots(figsize=(7, 3.4))
    largura = 0.36
    for desloc, modo, cor, rotulo in [(-largura / 2 - 0.01, "menu", MENU, "Menu numerado"), (largura / 2 + 0.01, "ia", IA, "Com IA")]:
        valores = [s[modo][k] for _, k in metricas]
        barras = ax.bar([i + desloc for i in range(len(metricas))], valores, largura, color=cor, label=rotulo)
        for b, v in zip(barras, valores):
            ax.text(b.get_x() + b.get_width() / 2, v + 0.3, str(v), ha="center", color=TINTA, fontsize=9)
    ax.set_xticks(range(len(metricas)), [m for m, _ in metricas])
    ax.set_ylim(0, n * 1.15)
    ax.set_ylabel(f"pedidos (de {n})")
    ax.set_title("Resultado dos pedidos por caminho")
    ax.legend(frameon=False, loc="upper right")
    ax.grid(axis="y", color=GRADE, linewidth=0.8)
    ax.set_axisbelow(True)
    salvar(fig, "6-resultado-experimento")


def fig_latencia_rodadas():
    """Mesma API, dias/horários diferentes: a latência da cota grátis varia muito."""
    rodadas = []
    for caminho, rotulo in [
        ("eval/resultados/ia-2026-11-19-rodada1.json", "Avaliação\n(rodada 1)"),
        ("eval/resultados/ia-2026-11-19.json", "Avaliação\n(final)"),
        ("eval/resultados/experimento-2026-11-19-rodada2.json", "Experimento\n(rodada 2)"),
        ("eval/resultados/experimento-2026-11-19.json", "Experimento\n(final)"),
    ]:
        if os.path.exists(caminho):
            with open(caminho, encoding="utf-8") as f:
                rodadas.append((rotulo, [x / 1000 for x in json.load(f)["latencias"]]))
    fig, ax = plt.subplots(figsize=(7, 3.6))
    caixas = ax.boxplot([v for _, v in rodadas], tick_labels=[r for r, _ in rodadas], patch_artist=True, widths=0.5,
                        medianprops={"color": TINTA, "linewidth": 1.5}, flierprops={"markeredgecolor": TINTA_2, "markersize": 4})
    for c in caixas["boxes"]:
        c.set_facecolor(IA)
        c.set_edgecolor(FUNDO)
    ax.axhline(8, color=TINTA, linewidth=1, linestyle="--")
    ax.text(0.55, 8.25, "limite do bot (8 s): acima disso ele usa o menu", va="bottom", ha="left", color=TINTA, fontsize=8,
            bbox={"facecolor": FUNDO, "edgecolor": "none", "pad": 1})
    ax.set_ylabel("segundos por chamada")
    ax.set_title("Variação do tempo de resposta do Gemini (cota grátis) entre rodadas")
    ax.grid(axis="y", color=GRADE, linewidth=0.8)
    ax.set_axisbelow(True)
    salvar(fig, "7-latencia-rodadas")


if __name__ == "__main__":
    ia = ultimo("ia")
    fig_intencoes(ia)
    fig_entidades(ia)
    fig_confusao(ia)
    fig_latencia(ia)
    exp = ultimo("experimento")
    fig_mensagens_por_perfil(exp)
    fig_resumo_experimento(exp)
    fig_latencia_rodadas()
