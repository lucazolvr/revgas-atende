/**
 * Cria no Google Forms o formulário do teste de usabilidade (SUS) do RevGás Atende.
 *
 * Como usar:
 * 1. Abra https://script.google.com, com a conta Google que vai ser dona do formulário,
 *    e clique em "Novo projeto".
 * 2. Apague o conteúdo do editor, cole este arquivo inteiro e salve (Ctrl+S).
 * 3. Escolha a função "criarFormulario" no topo e clique em "Executar".
 *    Na primeira vez, o Google pede autorização para criar formulários na sua conta: aceite.
 * 4. Os links aparecem no "Registro de execução": o de edição (para você) e o de resposta
 *    (para os participantes). O formulário também fica no seu Google Drive.
 *
 * Conteúdo: termo de consentimento (LGPD) obrigatório, código da sessão, as 10 afirmações
 * do SUS na versão brasileira (Lourenço; Valentim; Lopes, 2022, Tabela 1, versão consensual),
 * com "sistema" trocado por "atendimento", e as 3 perguntas abertas do protocolo.
 * Não coleta e-mail nem nome.
 */
function criarFormulario() {
  var form = FormApp.create('Avaliação do atendimento RevGás pelo WhatsApp');
  form.setDescription(
    'Teste de usabilidade do RevGás Atende, atendente virtual de pedidos de gás pelo WhatsApp. ' +
    'Projeto de Extensão VI, curso de Engenharia de Software do iCEV.');
  form.setCollectEmail(false);
  form.setProgressBar(true);
  form.setShowLinkToRespondAgain(false);
  form.setConfirmationMessage('Obrigado pela sua participação!');

  // 1. Termo de consentimento
  form.addSectionHeaderItem()
    .setTitle('Termo de consentimento')
    .setHelpText(
      'Você está sendo convidado(a) a participar de um teste de usabilidade do RevGás Atende, um atendente ' +
      'virtual de pedidos de gás pelo WhatsApp desenvolvido no Projeto de Extensão VI do curso de Engenharia ' +
      'de Software do iCEV.\n\n' +
      '• A participação é voluntária, e você pode desistir a qualquer momento, sem precisar justificar.\n' +
      '• Você fará um pedido fictício pelo WhatsApp, com nome e endereço que a equipe vai fornecer, e depois ' +
      'responderá a um questionário de cerca de 5 minutos.\n' +
      '• As mensagens que você enviar ao número do teste podem ser processadas pelo Gemini, serviço de ' +
      'inteligência artificial do Google, na cota gratuita, na qual o Google pode usar o conteúdo para melhorar ' +
      'seus produtos. Por isso, não envie dados pessoais reais além do seu número de telefone, que fica visível ' +
      'para a equipe no painel de atendimento durante o teste.\n' +
      '• O questionário não pede nome nem e-mail. Suas respostas são identificadas só por um código (P01 a P10) ' +
      'e aparecem no relatório sem identificação.\n' +
      '• O material das sessões fica com acesso restrito à equipe e é apagado após a entrega do trabalho.');
  var consentimento = form.addMultipleChoiceItem()
    .setTitle('Consentimento')
    .setRequired(true);
  consentimento.setChoices([consentimento.createChoice('Li e concordo em participar')]);

  // 2. Questionário (depois do pedido no WhatsApp)
  form.addPageBreakItem()
    .setTitle('Questionário')
    .setHelpText('Responda depois de fazer o pedido no WhatsApp, mesmo que não tenha conseguido concluir.');

  var codigo = form.addListItem()
    .setTitle('Código da sessão (a moderadora informa)')
    .setRequired(true);
  var codigos = ['P00 (piloto)'];
  for (var n = 1; n <= 10; n++) codigos.push('P' + (n < 10 ? '0' : '') + n);
  codigo.setChoiceValues(codigos);

  form.addSectionHeaderItem()
    .setTitle('Sobre o atendimento pelo WhatsApp')
    .setHelpText('Marque de 1 (discordo fortemente) a 5 (concordo fortemente). Não há resposta certa ou errada.');

  var afirmacoes = [
    'Eu acho que gostaria de usar esse atendimento frequentemente.',
    'Eu achei esse atendimento desnecessariamente complexo.',
    'Eu achei esse atendimento fácil de usar.',
    'Eu achei que precisaria de ajuda de uma pessoa técnica para ser capaz de usar esse atendimento.',
    'Eu achei que as várias funções desse atendimento foram bem integradas.',
    'Eu acho que o atendimento apresenta muita inconsistência.',
    'Eu imagino que a maioria das pessoas pode aprender a usar esse atendimento rapidamente.',
    'Eu achei esse atendimento muito pesado para usar.',
    'Eu me senti muito seguro usando o atendimento.',
    'Eu precisei aprender muitas coisas antes que pudesse utilizar esse atendimento.',
  ];
  afirmacoes.forEach(function (texto, i) {
    form.addScaleItem()
      .setTitle((i + 1) + '. ' + texto)
      .setBounds(1, 5)
      .setLabels('Discordo fortemente', 'Concordo fortemente')
      .setRequired(true);
  });

  // 3. Perguntas abertas
  form.addSectionHeaderItem().setTitle('Para terminar');
  [
    'Qual parte do pedido foi mais fácil? Por quê?',
    'Em que momento você teve dificuldade ou ficou sem saber o que fazer? O que aconteceu?',
    'Se pudesse mudar uma coisa no atendimento, o que mudaria?',
  ].forEach(function (pergunta) {
    form.addParagraphTextItem().setTitle(pergunta);
  });

  Logger.log('Link de edição (só para a equipe): ' + form.getEditUrl());
  Logger.log('Link para os participantes: ' + form.getPublishedUrl());
}
