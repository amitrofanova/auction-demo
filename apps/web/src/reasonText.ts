export function reasonText(reason: string, command?: string): string {
  if (reason === 'below_min' && command === 'place_bid') return 'Ставка ниже допустимой'
  if (reason === 'not_integer' && (command === 'place_bid' || command === 'set_autobroker')) return 'Нужна целая сумма'
  if (reason === 'max_too_low') return 'Потолок ниже допустимой цены'
  switch (reason) {
    case 'not_integer':
      return 'Нужны целые числа'
    case 'below_min':
      return 'Начальная стоимость и шаг больше нуля'
    case 'not_multiple':
      return 'Ставка должна быть кратна шагу'
    case 'already_leader':
      return 'Нельзя перебить свою ставку'
    case 'lot_closed':
      return 'Лот уже закрыт'
    case 'not_started':
      return 'Аукцион ещё не запущен'
    case 'not_buyer':
      return 'Продавец не делает ставки'
    case 'bad_duration':
      return 'Длительность от 1 до 1440 минут'
    case 'wrong_stage':
      return 'Сейчас это действие недоступно'
    case 'not_seller':
      return 'Это может сделать только продавец'
    case 'bad_message':
      return 'Некорректное сообщение'
    default:
      return 'Команда отклонена'
  }
}