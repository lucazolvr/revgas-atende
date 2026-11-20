# Aplica a marca RevGás no Chatwoot (pode rodar de novo sem problema):
#   docker compose exec -T chatwoot bundle exec rails runner "$(cat scripts/aplicar-marca.rb)"
# Os arquivos de marca/ são servidos pelo próprio Chatwoot em /marca/ (volume no docker-compose.yml).
# Grava só configurações do núcleo open source (MIT); não usa código do plano Enterprise.

v = (Time.now.to_i).to_s # muda a URL a cada aplicação para o navegador não usar o CSS antigo do cache

# DASHBOARD_SCRIPTS é dividido com o menu "Pedidos de hoje" (npm run chatwoot:config, aplicar-menu.rb):
# cada script troca só o seu bloco, entre <!-- revgas:NOME --> e <!-- /revgas:NOME -->.
def com_bloco(atual, nome, html)
  ini = "<!-- revgas:#{nome} -->"
  fim = "<!-- /revgas:#{nome} -->"
  sem = atual.to_s.gsub(/#{Regexp.escape(ini)}.*?#{Regexp.escape(fim)}\n?/m, '')
  html.to_s.empty? ? sem : "#{sem}#{ini}#{html}#{fim}\n"
end

scripts_atuais = InstallationConfig.find_by(name: 'DASHBOARD_SCRIPTS')&.value.to_s
  .gsub(%r{<link rel="stylesheet" href="/marca/tema\.css\?v=\d+">\n?}, '') # formato antigo, sem bloco

{
  'INSTALLATION_NAME' => 'RevGás Atende',
  'BRAND_NAME' => 'RevGás',
  'BRAND_URL' => 'https://revgas.com',
  'LOGO' => '/marca/logo.png',
  'LOGO_DARK' => '/marca/logo-escuro.png',
  'LOGO_THUMBNAIL' => '/marca/icone.png',
  'DASHBOARD_SCRIPTS' => com_bloco(scripts_atuais, 'tema', %(<link rel="stylesheet" href="/marca/tema.css?v=#{v}">))
}.each do |nome, valor|
  config = InstallationConfig.find_or_initialize_by(name: nome)
  config.value = valor
  config.locked = false
  config.save!
  puts "✓ #{nome}"
end

GlobalConfig.clear_cache
puts 'Marca aplicada. Recarregue o painel (Ctrl+F5).'
