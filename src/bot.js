const express = require('express');
const userM = require('./user');
const csrfM = require('./csrf');
const discM = require('./discord');
const r = require('./db');
const bot = require('./listbot');
const marked = require('marked');
const asciidoctor = require('asciidoctor.js')();
const crypto = require('crypto');
const reasons = require('./data/reasons.json');

const router = express.Router();
marked.setOptions({
	sanitize: true
});

router.get('/add', userM.auth, csrfM.make, (req, res) => {
	// Display the add screen
	res.render('add.pug', {
		csrf: req.csrf
	});
})
	.post('/add', userM.auth, csrfM.check, discM.validate, async (req, res) => {
		// Insert specific elements into the database.
		// Input validated by Discord Middleware
		const response = await r.table('bots')
			.insert({
				id: req.body.id,
				name: req.body.name,
				avatar: req.body.avatar,
				invite: req.body.invite,
				count: parseInt(req.body.count, 10),
				shortDesc: req.body.shortDesc,
				type: req.body.type,
				longDesc: req.body.longDesc,
				owner: req.user.id,
				approved: false,
				token: crypto.randomBytes(64).toString('hex'),
				timestamp: Date.now()
			})
			.run();

		if (response.errors) {
			res.status(409).render('error', {
				status: 409,
				message: res.__('error_duplicate_bot')
			});
		} else {
			res.render('error', {
				status: 200,
				message: res.__('message_bot_inserted')
			});
			// Send message to Discord Channel
			bot.channel.createMessage(`<@${req.user.id}> added \`${req.body.name}\` <@${req.body.id}>`);
		}
	})
	.get('/:id', csrfM.make, async (req, res) => {
		// Check if the count is empty
		const exists = await r.table('bots')
			.get(req.params.id)
			.run();

		if (exists) {
			const botinfo = await r.table('bots')
				.get(req.params.id)
				.without('token')
				.merge(info => ({
					ownerinfo: r.table('users').get(info('owner'))
				}))
				.run();
			if ((req.user && req.user.id) === botinfo.owner || (req.user && req.user.admin)) {
				botinfo.editable = true;
			}
			res.render('botpage', {
				botinfo,
				marked,
				asciidoctor,
				csrf: req.csrf
			});
		} else {
			res.status(404).render('error', {
				csrf: res.csrf,
				status: 404,
				message: res.__('error_bot_not_found')
			});
		}
	})
	.get('/:id/edit', userM.auth, csrfM.make, discM.owns, (req, res) => {
		// Display the edit screen with the bot's items
		res.render('edit.pug', {
			csrf: req.csrf,
			bot: res.locals.bot
		});
	})
	.post('/:id/edit', userM.auth, csrfM.check, discM.owns, discM.validate, async (req, res) => {
		// Edit only the bits that need to be edited
		const response = await r.table('bots')
			.get(req.body.id)
			.update({
				name: req.body.name,
				avatar: req.body.avatar,
				invite: req.body.invite,
				count: parseInt(req.body.count, 10),
				shortDesc: req.body.shortDesc,
				type: req.body.type,
				longDesc: req.body.longDesc
			})
			.run();

		if (response.unchanged) {
			res.render('error', {
				status: 200,
				message: res.__('message_bot_unchanged')
			});
		} else {
			res.render('error', {
				status: 200,
				message: res.__('message_bot_changed')
			});
			bot.channel.createMessage(`<@${req.user.id}> edited \`${res.locals.bot.name}\` <@${res.locals.bot.id}> by <@${res.locals.bot.owner}>`);
		}
	})
	.get('/:id/delete', userM.auth, csrfM.make, discM.owns, (req, res) => {
		// View a page before deleting the bot
		res.render('delete', {
			csrf: req.csrf
		});
	})
	.get('/:id/delete', userM.auth, csrfM.make, discM.owns, (req, res) => {
		// View a page before deleting the bot
		res.render('delete.pug', {
			csrf: req.csrf,
			title: 'Delete Bot'
		});
	})
	.post('/:id/delete', userM.auth, csrfM.check, discM.owns, (req, res) => {
		// Delete the bot
		r.table('bots')
			.get(req.params.id)
			.delete()
			.run();

		res.render('error', {
			status: 200,
			message: res.__('message_bot_deleted')
		});
		bot.channel.createMessage(`<@${req.user.id}> deleted \`${res.locals.bot.name}\` <@${res.locals.bot.id}> by <@${res.locals.bot.owner}>`);
	})
	.get('/:id/token', userM.auth, csrfM.make, discM.owns, (req, res) => {
		// Display the token for this bot
		res.render('token.pug', {
			csrf: req.csrf,
			bot: res.locals.bot
		});
	})
	.get('/:id/iframe', async (req, res) => {
		const result = await r.table('bots')
			.get(req.params.id)
			.run();

		if (result && result.type === 'html') {
			res.send(result.longDesc);
		} else {
			res.status(404).render('error', {
				status: 404,
				message: res.__('error_bot_html_not_found')
			});
		}
	})
	.post('/:id/token', userM.auth, csrfM.check, discM.owns, (req, res) => {
		res.redirect(`/token/${req.params.id}`);

		r.table('bots')
			.get(req.params.id)
			.update({
				token: crypto.randomBytes(64).toString('hex')
			}, {
				returnChanges: true
			})
			.run();
	})
	.post('/:id/approve', userM.auth, csrfM.check, userM.admin, async (req, res) => {
		const previous = req.header('Referer') || '/';
		const result = await r.table('bots')
			.get(req.body.id)
			.update({
				approved: true
			}, {
				returnChanges: true
			})
			.run();
		if (res.skipped) {
			res.status(404).render('error', { status: 404, message: 'Bot Not found' });
		} else if (!result.changes) {
			res.redirect(previous);
		} else {
			res.redirect(previous);
			bot.channel.createMessage(`<@${req.user.id}> approved \`${result.changes[0].old_val.name}\` <@${result.changes[0].old_val.id}> by <@${result.changes[0].old_val.owner}>`);
		}
	})
	.get('/:id/remove', userM.auth, csrfM.make, userM.admin, async (req, res) => {
		res.render('remove', {
			csrf: req.csrf,
			reasons: reasons.remove
		});
	})
	.post('/:id/remove', userM.auth, csrfM.check, userM.admin, async (req, res) => {
		const user = await r.table('bots')
			.get(req.params.id)
			.run();

		if (!user) {
			res.status(404).render('error', { status: 404, message: 'Bot Not found' });
		} else if (typeof req.body.reason !== 'string' || typeof req.body.description !== 'string' || req.body.description.length > 1000) {
			res.status(400).render('error', { status: 400, message: 'The reason or description was invalid' });
		} if (reasons.remove[req.body.reason]) {
			r.table('bots')
				.get(req.params.id)
				.delete()
				.run();
			res.redirect('/');
			bot.channel.createMessage(`<@${req.user.id}> deleted \`${user.name}\` <@${user.id}> by <@${user.owner}> for: \`${res.__(`remove_${reasons.remove[req.body.reason]}`)}\` (${req.body.reason})\n${req.body.description}`);
		} else {
			res.status(400).render('error', { status: 400, message: 'Invalid reason' });
		}
	});

module.exports = router;